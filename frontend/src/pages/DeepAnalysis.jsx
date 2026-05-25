import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { BrainCircuit, RefreshCcw } from 'lucide-react';
import { getDeepAnalysis, getPois } from '../api';
import { echarts } from '../lib/echarts';

const formatPercent = (value) => `${Number(value || 0).toFixed(2)}%`;
const formatNumber = (value) => Number(value || 0).toLocaleString(undefined, {
  maximumFractionDigits: 4,
});

const DEEP_FEATURE_TYPES = {
  bounce_rate: 'percent',
  pay_conversion: 'percent',
  silent_pay_conversion: 'percent',
  price_multiplier: 'number',
  live_pay_amount: 'currency',
  redeem_rate_amount: 'percent',
  refund_rate_amount: 'percent',
  pay_amount: 'currency',
};

const formatDailyAverage = (feature) => {
  const value = Number(feature.daily_average || 0);
  const valueType = DEEP_FEATURE_TYPES[feature.key] || (feature.value_kind === 'rate' ? 'percent' : 'number');
  if (valueType === 'percent') {
    return formatPercent(value);
  }
  if (valueType === 'currency') {
    return `¥${value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
};

const renderSignificance = (pValue) => {
  if (pValue < 0.01) {
    return (
      <span style={{
        fontSize: '12px',
        padding: '3px 8px',
        borderRadius: '6px',
        background: 'rgba(217, 4, 41, 0.1)',
        color: 'var(--danger)',
        fontWeight: 'bold',
        border: '1px solid rgba(217, 4, 41, 0.2)'
      }}>
        极显著 (p &lt; 0.01)
      </span>
    );
  }
  if (pValue < 0.05) {
    return (
      <span style={{
        fontSize: '12px',
        padding: '3px 8px',
        borderRadius: '6px',
        background: 'rgba(224, 122, 95, 0.15)',
        color: 'var(--accent)',
        fontWeight: 'bold',
        border: '1px solid rgba(224, 122, 95, 0.28)'
      }}>
        显著 (p &lt; 0.05)
      </span>
    );
  }
  return (
    <span style={{
      fontSize: '12px',
      padding: '3px 8px',
      borderRadius: '6px',
      background: 'rgba(0, 0, 0, 0.05)',
      color: 'var(--text-muted)',
      border: '1px solid rgba(0, 0, 0, 0.08)'
    }}>
      不显著
    </span>
  );
};

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
      color: ['#e07a5f', '#f4a261', '#2a9d8f', '#e76f51', '#457b9d', '#1d3557'],
      series: [
        {
          name: 'SHAP影响权重',
          type: 'pie',
          radius: ['42%', '70%'],
          center: ['38%', '52%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 8,
            borderColor: '#fffcf5',
            borderWidth: 2.5,
          },
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
          <h2>利润变化影响权重与因果推断 (A+B+C 升级版)</h2>
          <p>
            系统基于<strong>单个商品单日变化量</strong>建模，排除了商品自身的历史固定偏差。
            利用机器学习集成估计器与 <strong>SHAP 归因</strong> 分配解释权重，并结合 <strong>双重机器学习 (Double ML)</strong> 技术评估各指标对利润的“真实因果效应”，提供科学的商业决策建议。
          </p>
        </div>
      </section>

      <section className="glass-panel deep-analysis-toolbar mb-32">
        <div className="deep-analysis-scope-copy">
          <span>分析范围</span>
          <h3>{selectedScopeLabel}</h3>
          <p>选择某个 POI 后，模型只会使用该 POI 下的商品样本计算影响权重与因果关系。</p>
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
        <div className="glass-panel poi-empty-state skeleton-pulse">集成估计器与因果网络实时训练中...</div>
      ) : errorMessage ? (
        <div className="glass-panel poi-empty-state">{errorMessage}</div>
      ) : !analysis ? (
        <div className="glass-panel poi-empty-state">暂无分析结果</div>
      ) : !hasReadyResult ? (
        <div className="glass-panel deep-analysis-empty">
          <h3>暂时无法训练稳定模型</h3>
          <p>{analysis.message}</p>
          <span>当前双数据齐全日期：{analysis.date_count} 天，商品-天级变化样本：{analysis.sample_count} 个。</span>
        </div>
      ) : (
        <>
          <div className="deep-analysis-summary-grid mb-32">
            <div className="glass-panel deep-analysis-stat">
              <span>覆盖数据日期</span>
              <strong>{analysis.date_count} 天</strong>
              <p>{analysis.date_range.start} 至 {analysis.date_range.end}</p>
            </div>
            <div className="glass-panel deep-analysis-stat">
              <span>商品日变化样本数</span>
              <strong>{analysis.sample_count} 个</strong>
              <p>样本量大幅放大，保障模型统计代表性</p>
            </div>
            <div className="glass-panel deep-analysis-stat">
              <span>模型拟合度 (R² Score)</span>
              <strong>{formatNumber(analysis.model?.r2_score)}</strong>
              <p>R² 反映集成模型对利润变动的解释力度</p>
            </div>
          </div>

          <div className="deep-analysis-layout mb-32">
            <section className="glass-panel deep-analysis-chart-card">
              <h3>六个维度 SHAP 权重分配</h3>
              <ReactEChartsCore
                echarts={echarts}
                option={pieOption}
                style={{ height: '420px' }}
                opts={{ renderer: 'svg' }}
              />
            </section>

            <section className="glass-panel deep-analysis-table-card">
              <h3>核心算法指标明细</h3>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>维度</th>
                      <th>每日均值</th>
                      <th>SHAP 权重</th>
                      <th>相关性 (r)</th>
                      <th>因果效应 (ATE)</th>
                      <th>统计显著性</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.features.map((feature) => (
                      <tr key={feature.key}>
                        <td style={{ fontWeight: 'bold' }}>{feature.label}</td>
                        <td>{formatDailyAverage(feature)}</td>
                        <td style={{ fontWeight: 'bold', color: 'var(--accent)' }}>{formatPercent(feature.weight)}</td>
                        <td>{formatNumber(feature.correlation)}</td>
                        <td className={feature.causal_effect >= 0 ? 'deep-direction-up' : 'deep-direction-down'}>
                          {feature.causal_effect >= 0 ? '+' : ''}{formatNumber(feature.causal_effect)}
                        </td>
                        <td>{renderSignificance(feature.p_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* 智能因果运营决策建议板块 */}
          <div className="glass-panel mb-32">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 16px 0', fontSize: '18px', fontWeight: '800', color: '#2c241b' }}>
              🎯 智能因果决策建议 (Causal AI Insights)
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '16px' }}>
              {analysis.features.map((feature) => {
                const isSig = feature.p_value < 0.05;
                const isHighlySig = feature.p_value < 0.01;
                const sigText = isHighlySig ? '极显著' : (isSig ? '显著' : '不显著');
                const sigColor = isHighlySig ? 'var(--danger)' : (isSig ? 'var(--accent)' : 'var(--text-muted)');
                const dirText = feature.causal_effect >= 0 ? '正向因果' : '负向因果';
                const dirClass = feature.causal_effect >= 0 ? 'deep-direction-up' : 'deep-direction-down';

                return (
                  <div key={feature.key} style={{
                    padding: '18px',
                    borderRadius: '16px',
                    background: 'rgba(255, 255, 255, 0.48)',
                    border: `1.5px solid ${isSig ? 'rgba(224, 122, 95, 0.28)' : 'rgba(0,0,0,0.06)'}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    boxShadow: isSig ? '0 8px 24px -16px rgba(224, 122, 95, 0.4)' : 'none',
                    transition: 'all 0.2s ease'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '15px', color: '#2c241b' }}>{feature.label}</strong>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <span className={dirClass} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.7)', border: '1px solid currentColor' }}>
                          {dirText}
                        </span>
                        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.7)', border: `1px solid ${sigColor}`, color: sigColor, fontWeight: 700 }}>
                          {sigText}
                        </span>
                      </div>
                    </div>
                    <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--text-main)', lineHeight: 1.6 }}>
                      {feature.recommendation}
                    </p>
                    <div style={{ display: 'flex', gap: '14px', fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px', borderTop: '1.5px solid rgba(0,0,0,0.04)', paddingTop: '8px' }}>
                      <span>因果效应 (ATE): <strong style={{ color: 'var(--text-main)' }}>{feature.causal_effect >= 0 ? '+' : ''}{feature.causal_effect.toFixed(4)}</strong></span>
                      <span>置信区间: <strong style={{ color: 'var(--text-main)' }}>[{feature.ci_lower.toFixed(3)}, {feature.ci_upper.toFixed(3)}]</strong></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <section className="glass-panel deep-analysis-note">
            <h3>🤖 算法模型与统计学说明</h3>
            <p><strong>计算模型：</strong>{analysis.model?.algorithm}</p>
            <p><strong>技术释义：</strong></p>
            <ul>
              <li><strong>样本粒度（商品-天级）</strong>：放弃传统的宏观天数聚合，以单个商品在单日的变化为回归单元，模型能够捕捉不同商品的细分动态，信息量和数据代表性获得数十倍乃至数百倍的扩充。</li>
              <li><strong>SHAP 权重</strong>：采用沙普利值 (Shapley Value) 对多模型预测结果进行解耦，在排除了多重共线性干扰的前提下，客观反映六大维度在模型中对利润变动解释的“相对权重”，相加总计为 100%。</li>
              <li><strong>因果效应 (ATE)</strong>：基于双重机器学习 (Double ML) 的 Robinson 残差去偏算法，分别拟合特征混杂函数和结果混杂函数，剥离传统相关分析中的混杂偏误，得到真正的因果传导系数（平均处理效应 ATE）。例如，详情页跳出率若呈极显著负向因果，代表优化跳出率将直接带来利润率的改善。</li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

export default DeepAnalysis;
