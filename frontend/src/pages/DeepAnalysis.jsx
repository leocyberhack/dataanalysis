import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { BrainCircuit, RefreshCcw } from 'lucide-react';
import { getDeepAnalysis, getPois } from '../api';
import { echarts } from '../lib/echarts';

const formatPercent = (value) => `${Number(value || 0).toFixed(2)}%`;
const formatNumber = (value) => Number(value || 0).toLocaleString(undefined, {
  maximumFractionDigits: 2,
});

function DeepAnalysis() {
  const [analysis, setAnalysis] = useState(null);
  const [pois, setPois] = useState([]);
  const [selectedPoi, setSelectedPoi] = useState('');
  const [loading, setLoading] = useState(false);
  const [poiLoading, setPoiLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const loadAnalysis = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const payload = await getDeepAnalysis(selectedPoi);
      setAnalysis(payload);
    } catch (error) {
      console.error(error);
      setErrorMessage(error.response?.data?.detail || error.message || '深度分析加载失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, [selectedPoi]);

  useEffect(() => {
    loadAnalysis();
  }, [loadAnalysis]);

  useEffect(() => {
    const loadPois = async () => {
      setPoiLoading(true);
      try {
        const payload = await getPois();
        setPois(payload || []);
      } catch (error) {
        console.error(error);
      } finally {
        setPoiLoading(false);
      }
    };

    loadPois();
  }, []);

  const pieOption = useMemo(() => {
    const features = analysis?.features || [];
    return {
      tooltip: {
        trigger: 'item',
        valueFormatter: (value) => formatPercent(value),
      },
      legend: {
        type: 'scroll',
        orient: 'vertical',
        right: 10,
        top: 24,
        bottom: 24,
        textStyle: { color: 'var(--text-muted)' },
      },
      series: [
        {
          name: '利润影响权重',
          type: 'pie',
          radius: ['42%', '70%'],
          center: ['38%', '52%'],
          avoidLabelOverlap: true,
          label: {
            formatter: '{b}\n{d}%',
            color: 'var(--text-main)',
            fontWeight: 700,
          },
          labelLine: { length: 18, length2: 10 },
          data: features.map((feature) => ({
            name: feature.label,
            value: Number(feature.weight || 0),
          })),
        },
      ],
    };
  }, [analysis]);

  const hasReadyResult = analysis?.status === 'ready' && analysis.features?.length > 0;
  const selectedScopeLabel = selectedPoi || '全部 POI';
  let cacheStatusText = '等待数据';
  if (loading) {
    cacheStatusText = '训练/读取中';
  } else if (analysis?.cached) {
    cacheStatusText = '使用缓存结果';
  } else if (analysis) {
    cacheStatusText = '已重新训练';
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">深度分析</h1>
        <button type="button" className="btn btn-secondary" onClick={loadAnalysis} disabled={loading}>
          <RefreshCcw size={16} />
          刷新结果
        </button>
      </div>

      <section className="glass-panel deep-analysis-hero mb-32">
        <BrainCircuit size={28} color="var(--accent)" />
        <div>
          <h2>利润变化影响权重</h2>
          <p>
            系统只使用商品数据和利润数据都齐全的日期；默认合并全部 POI，也可以单独查看某个 POI。
            算法会同时考虑六个维度之间的相关性，避免把高度相关的指标重复算权重。
            当双数据齐全日期没有新增时，会直接读取缓存结果，减少重复训练消耗。
          </p>
        </div>
      </section>

      <section className="glass-panel deep-analysis-toolbar mb-32">
        <div className="deep-analysis-scope-copy">
          <span>分析范围</span>
          <h3>{selectedScopeLabel}</h3>
          <p>选择某个 POI 后，模型只会使用该 POI 下商品在双数据齐全日期里的变化来计算权重。</p>
        </div>
        <label className="deep-analysis-scope-select">
          <span>选择 POI</span>
          <select
            value={selectedPoi}
            onChange={(event) => setSelectedPoi(event.target.value)}
            disabled={poiLoading || loading}
          >
            <option value="">全部 POI</option>
            {pois.map((poi) => (
              <option key={poi.id} value={poi.name}>{poi.name}</option>
            ))}
          </select>
        </label>
        <div className={`deep-analysis-cache-pill ${analysis?.cached ? 'is-cached' : 'is-fresh'}`}>
          {cacheStatusText}
        </div>
      </section>

      {loading ? (
        <div className="glass-panel poi-empty-state">深度学习模型训练中...</div>
      ) : errorMessage ? (
        <div className="glass-panel poi-empty-state">{errorMessage}</div>
      ) : !analysis ? (
        <div className="glass-panel poi-empty-state">暂无分析结果</div>
      ) : !hasReadyResult ? (
        <div className="glass-panel deep-analysis-empty">
          <h3>暂时无法训练稳定模型</h3>
          <p>{analysis.message}</p>
          <span>当前双数据齐全日期：{analysis.date_count} 天，变化样本：{analysis.sample_count} 个。</span>
        </div>
      ) : (
        <>
          <div className="deep-analysis-summary-grid mb-32">
            <div className="glass-panel deep-analysis-stat">
              <span>训练日期</span>
              <strong>{analysis.date_count} 天</strong>
              <p>{analysis.date_range.start} 至 {analysis.date_range.end}</p>
            </div>
            <div className="glass-panel deep-analysis-stat">
              <span>变化样本</span>
              <strong>{analysis.sample_count} 个</strong>
              <p>按相邻双数据日期的日变化建模</p>
            </div>
            <div className="glass-panel deep-analysis-stat">
              <span>交叉验证岭回归</span>
              <strong>{formatNumber(analysis.model?.r2_score)}</strong>
              <p>R² 越高代表拟合解释度越强</p>
            </div>
          </div>

          <div className="deep-analysis-layout mb-32">
            <section className="glass-panel deep-analysis-chart-card">
              <h3>六个维度权重分配</h3>
              <ReactEChartsCore
                echarts={echarts}
                option={pieOption}
                style={{ height: '420px' }}
                opts={{ renderer: 'svg' }}
              />
            </section>

            <section className="glass-panel deep-analysis-table-card">
              <h3>权重明细</h3>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>维度</th>
                      <th>权重</th>
                      <th>方向</th>
                      <th>置换重要性</th>
                      <th>相关性</th>
                      <th>共线性</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.features.map((feature) => (
                      <tr key={feature.key}>
                        <td>{feature.label}</td>
                        <td>{formatPercent(feature.weight)}</td>
                        <td className={feature.direction === 'positive' ? 'deep-direction-up' : 'deep-direction-down'}>
                          {feature.direction === 'positive' ? '正向' : '负向'}
                        </td>
                        <td>{formatNumber(feature.permutation_importance)}</td>
                        <td>{formatNumber(feature.correlation)}</td>
                        <td>{formatNumber(feature.redundancy)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <section className="glass-panel deep-analysis-note">
            <h3>模型说明</h3>
            <p>{analysis.model?.algorithm}</p>
            <p>
              权重不是简单相关系数，而是综合了岭回归系数、置换重要性和指标间共线性校正；
              因此支付金额、浏览量等互相相关的指标不会被简单重复计入。
            </p>
          </section>
        </>
      )}
    </div>
  );
}

export default DeepAnalysis;
