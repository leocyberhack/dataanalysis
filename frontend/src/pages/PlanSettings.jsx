import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, RefreshCcw, Target, Trash2 } from 'lucide-react';
import { createPlan, deletePlan, getPlans, getPois } from '../api';
import { ALL_METRICS, METRIC_KEYS, formatMetricValue } from '../constants/compareMetrics';

const getCurrentMonthKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const normalizeSearchText = (value) => value.toLowerCase().replace(/\s+/g, '');

const formatMonthLabel = (month) => {
  const [year, monthNumber] = String(month).split('-');
  return `${year}年${Number(monthNumber)}月`;
};

function PlanSettings() {
  const [plans, setPlans] = useState([]);
  const [pois, setPois] = useState([]);
  const [planName, setPlanName] = useState('');
  const [metric, setMetric] = useState(METRIC_KEYS[0]);
  const [targetValue, setTargetValue] = useState('');
  const [poiMode, setPoiMode] = useState('all');
  const [selectedPois, setSelectedPois] = useState([]);
  const [poiSearch, setPoiSearch] = useState('');
  const [monthInput, setMonthInput] = useState(getCurrentMonthKey());
  const [selectedMonths, setSelectedMonths] = useState([getCurrentMonthKey()]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const poiOptions = useMemo(
    () => pois.map((poi) => ({ value: poi.id, label: poi.name })),
    [pois],
  );

  const filteredPois = useMemo(() => {
    const keyword = normalizeSearchText(poiSearch);
    if (!keyword) {
      return poiOptions;
    }
    return poiOptions.filter((poi) => normalizeSearchText(poi.label).includes(keyword));
  }, [poiOptions, poiSearch]);

  const selectedPoiSet = useMemo(() => new Set(selectedPois), [selectedPois]);
  const allFilteredSelected = filteredPois.length > 0
    && filteredPois.every((poi) => selectedPoiSet.has(poi.value));

  const loadPlans = async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const [nextPlans, nextPois] = await Promise.all([getPlans(), getPois()]);
      setPlans(nextPlans || []);
      setPois(nextPois || []);
    } catch (error) {
      console.error(error);
      setErrorMessage(error.response?.data?.detail || error.message || '计划数据加载失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlans();
  }, []);

  const handleTogglePoi = (poiName) => {
    setSelectedPois((previous) => {
      const nextValues = new Set(previous);
      if (nextValues.has(poiName)) {
        nextValues.delete(poiName);
      } else {
        nextValues.add(poiName);
      }
      return Array.from(nextValues);
    });
  };

  const handleToggleFilteredPois = () => {
    setSelectedPois((previous) => {
      const nextValues = new Set(previous);
      if (allFilteredSelected) {
        filteredPois.forEach((poi) => nextValues.delete(poi.value));
      } else {
        filteredPois.forEach((poi) => nextValues.add(poi.value));
      }
      return Array.from(nextValues);
    });
  };

  const handleAddMonth = () => {
    if (!monthInput) {
      return;
    }
    setSelectedMonths((previous) => Array.from(new Set([...previous, monthInput])).sort());
  };

  const handleRemoveMonth = (month) => {
    setSelectedMonths((previous) => previous.filter((item) => item !== month));
  };

  const resetForm = () => {
    setPlanName('');
    setTargetValue('');
    setPoiMode('all');
    setSelectedPois([]);
    setPoiSearch('');
    setMonthInput(getCurrentMonthKey());
    setSelectedMonths([getCurrentMonthKey()]);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage('');

    const numericTarget = Number(targetValue);
    if (!Number.isFinite(numericTarget) || numericTarget <= 0) {
      setErrorMessage('目标数字需要大于 0。');
      return;
    }
    if (!selectedMonths.length) {
      setErrorMessage('请至少选择一个月份。');
      return;
    }
    if (poiMode === 'selected' && selectedPois.length === 0) {
      setErrorMessage('选择“部分 POI”时，请至少勾选一个 POI。');
      return;
    }

    setSaving(true);
    try {
      await createPlan({
        name: planName,
        metric,
        target_value: numericTarget,
        poi_mode: poiMode,
        poi_names: poiMode === 'selected' ? selectedPois : [],
        months: selectedMonths,
      });
      resetForm();
      await loadPlans();
    } catch (error) {
      console.error(error);
      setErrorMessage(error.response?.data?.detail || error.message || '计划创建失败，请稍后重试。');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePlan = async (planId) => {
    if (!window.confirm('确认删除这个计划吗？')) {
      return;
    }
    try {
      await deletePlan(planId);
      await loadPlans();
    } catch (error) {
      console.error(error);
      setErrorMessage(error.response?.data?.detail || error.message || '计划删除失败，请稍后重试。');
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">计划设定</h1>
      </div>

      <section className="glass-panel plan-builder-card mb-32">
        <div className="plan-section-title">
          <Target size={20} color="var(--accent)" />
          <div>
            <h2>新建计划</h2>
            <p>选择一个指标、一个或多个月份，以及全部或部分 POI。多个 POI 会合并计算为一个总进度。</p>
          </div>
        </div>

        <form className="plan-form" onSubmit={handleSubmit}>
          <div className="plan-form-grid">
            <div className="input-group">
              <label className="input-label">计划名称</label>
              <input
                className="input"
                value={planName}
                onChange={(event) => setPlanName(event.target.value)}
                placeholder="例如：5月湖泉支付目标"
              />
            </div>

            <div className="input-group">
              <label className="input-label">指标</label>
              <select className="select" value={metric} onChange={(event) => setMetric(event.target.value)}>
                {METRIC_KEYS.map((metricKey) => (
                  <option value={metricKey} key={metricKey}>{ALL_METRICS[metricKey]}</option>
                ))}
              </select>
            </div>

            <div className="input-group">
              <label className="input-label">目标数字</label>
              <input
                className="input"
                type="number"
                step="0.01"
                min="0"
                value={targetValue}
                onChange={(event) => setTargetValue(event.target.value)}
                placeholder={`${ALL_METRICS[metric]} 的月度目标`}
              />
            </div>
          </div>

          <div className="plan-month-picker">
            <div className="input-group">
              <label className="input-label">选择月份</label>
              <div className="plan-month-input-row">
                <input
                  className="input"
                  type="month"
                  value={monthInput}
                  onChange={(event) => setMonthInput(event.target.value)}
                />
                <button type="button" className="btn" onClick={handleAddMonth}>
                  添加月份
                </button>
              </div>
            </div>
            <div className="plan-month-tags">
              {selectedMonths.map((month) => (
                <button type="button" className="plan-month-tag" key={month} onClick={() => handleRemoveMonth(month)}>
                  {formatMonthLabel(month)} ×
                </button>
              ))}
            </div>
          </div>

          <div className="plan-poi-mode">
            <label className={`plan-radio-card ${poiMode === 'all' ? 'is-selected' : ''}`}>
              <input
                type="radio"
                name="poiMode"
                checked={poiMode === 'all'}
                onChange={() => setPoiMode('all')}
              />
              <span>全部 POI</span>
            </label>
            <label className={`plan-radio-card ${poiMode === 'selected' ? 'is-selected' : ''}`}>
              <input
                type="radio"
                name="poiMode"
                checked={poiMode === 'selected'}
                onChange={() => setPoiMode('selected')}
              />
              <span>部分 POI</span>
            </label>
          </div>

          {poiMode === 'selected' && (
            <div className="plan-poi-selector">
              <div className="plan-poi-toolbar">
                <input
                  className="compare-selector-search"
                  value={poiSearch}
                  onChange={(event) => setPoiSearch(event.target.value)}
                  placeholder="搜索 POI"
                />
                <button
                  type="button"
                  className="compare-selector-action"
                  onClick={handleToggleFilteredPois}
                  disabled={filteredPois.length === 0}
                >
                  {allFilteredSelected ? '取消当前筛选' : '选择当前筛选'}
                </button>
              </div>
              <div className="plan-poi-count">已选择 {selectedPois.length} / {poiOptions.length}</div>
              <div className="compare-checkbox-list plan-poi-list">
                {filteredPois.length > 0 ? filteredPois.map((poi) => {
                  const checked = selectedPoiSet.has(poi.value);
                  return (
                    <label className={`compare-checkbox-item ${checked ? 'is-selected' : ''}`} key={poi.value}>
                      <input type="checkbox" checked={checked} onChange={() => handleTogglePoi(poi.value)} />
                      <span className="compare-checkbox-label" title={poi.label}>{poi.label}</span>
                    </label>
                  );
                }) : (
                  <div className="compare-selector-empty">没有匹配的 POI</div>
                )}
              </div>
            </div>
          )}

          {errorMessage && <div className="plan-error">{errorMessage}</div>}

          <div className="plan-form-actions">
            <button type="submit" className="btn" disabled={saving}>
              {saving ? '保存中...' : '保存计划'}
            </button>
          </div>
        </form>
      </section>

      <section className="plan-list-section">
        <div className="plan-list-header">
          <div className="plan-section-title">
            <CalendarDays size={20} color="var(--accent)" />
            <div>
              <h2>计划进度</h2>
              <p>进度会根据后台已有数据实时计算；多选 POI 会合并为总计。</p>
            </div>
          </div>
          <button type="button" className="btn btn-secondary" onClick={loadPlans} disabled={loading}>
            <RefreshCcw size={16} />
            刷新
          </button>
        </div>

        {loading ? (
          <div className="glass-panel poi-empty-state">计划加载中...</div>
        ) : plans.length === 0 ? (
          <div className="glass-panel poi-empty-state">暂无计划，先创建一个目标吧。</div>
        ) : (
          <div className="plan-card-grid">
            {plans.map((plan) => {
              const poiLabel = plan.poi_mode === 'all'
                ? '全部 POI'
                : `${plan.poi_names.length} 个 POI：${plan.poi_names.join('、')}`;

              return (
                <article className="glass-panel plan-card" key={plan.id}>
                  <div className="plan-card-header">
                    <div>
                      <h3>{plan.name || `${ALL_METRICS[plan.metric]}计划`}</h3>
                      <p>{ALL_METRICS[plan.metric]} · {poiLabel}</p>
                    </div>
                    <button
                      type="button"
                      className="plan-delete-button"
                      onClick={() => handleDeletePlan(plan.id)}
                      aria-label="删除计划"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>

                  <div className="plan-progress-list">
                    {plan.progress.map((progress) => {
                      const cappedPercentage = Math.min(Math.max(progress.percentage, 0), 100);
                      return (
                        <div
                          className={`plan-progress-item ${progress.achieved ? 'is-achieved' : 'is-pending'}`}
                          key={`${plan.id}-${progress.month}`}
                        >
                          <div className="plan-progress-topline">
                            <span>{formatMonthLabel(progress.month)}</span>
                            <strong>{progress.percentage.toFixed(2)}%</strong>
                          </div>
                          <div className="plan-progress-bar" aria-hidden="true">
                            <span style={{ width: `${cappedPercentage}%` }} />
                          </div>
                          <div className="plan-progress-values">
                            {formatMetricValue(plan.metric, progress.actual_value)}
                            {' / '}
                            {formatMetricValue(plan.metric, progress.target_value)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default PlanSettings;
