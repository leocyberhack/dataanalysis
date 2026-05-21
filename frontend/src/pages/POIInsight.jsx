import { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import DatePicker, { registerLocale } from 'react-datepicker';
import { zhCN } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { ArrowDownRight, ArrowUpRight, Minus, Trophy, X } from 'lucide-react';
import {
  getCompareAggregate,
  getCompareTrend,
  getDateStatus,
  getDates,
  getPoiProductMetricBreakdown,
} from '../api';
import {
  formatDateKey,
  formatDateRangeKeys,
  getInclusiveDayCount,
  parseStoredDate,
} from '../utils/date';
import { createDateStatusDayRenderer } from '../utils/dateStatusDayRenderer';
import { echarts } from '../lib/echarts';

registerLocale('zh-CN', zhCN);

const MODULE_CONFIGS = {
  traffic: {
    title: '流量入口',
    compositeTitle: '综合流量 POI 排名前五',
    metrics: [
      { key: 'visitor_count', label: '访客数', type: 'number' },
      { key: 'bounce_rate', label: '商品详情页跳出率', type: 'percent' },
      { key: 'page_views', label: '浏览量', type: 'number' },
    ],
  },
  conversion: {
    title: '转化数据',
    compositeTitle: '综合转化 POI 排名前五',
    metrics: [
      { key: 'order_conversion', label: '下单转化率', type: 'percent' },
      { key: 'avg_visitor_value', label: '访客平均价值', type: 'currency' },
      { key: 'order_user_pay_rate', label: '下单用户支付率', type: 'percent' },
    ],
  },
  sales: {
    title: '销售数据',
    compositeTitle: '综合销售 POI 排名前五',
    metrics: [
      { key: 'pay_amount', label: '支付金额', type: 'currency' },
      { key: 'redeem_rate_amount', label: '核销率(金额)', type: 'percent' },
      { key: 'redeem_amount', label: '核销金额', type: 'currency' },
      { key: 'redeem_rate_item', label: '核销率(件数)', type: 'percent' },
      { key: 'redeem_items', label: '核销件数', type: 'number' },
      { key: 'pay_items', label: '支付件数', type: 'number' },
    ],
  },
  refund: {
    title: '退款数据',
    compositeTitle: '综合退款 POI 排名前五',
    metrics: [
      { key: 'refund_amount', label: '成功退款金额', type: 'currency' },
      { key: 'refund_rate_amount', label: '成功退款率(金额)', type: 'percent' },
      { key: 'refund_rate_item', label: '成功退款率(件数)', type: 'percent' },
      { key: 'refund_items', label: '成功退款件数', type: 'number' },
    ],
  },
  profit: {
    title: '利润数据',
    compositeTitle: '综合利润 POI 排名前五',
    metrics: [
      { key: 'profit', label: '商品利润', type: 'currency' },
    ],
  },
};

const TREND_LIMIT = 5;
const RANK_LIMIT = 5;
const INITIAL_DETAIL_MODAL = {
  isOpen: false,
  poiKey: '',
  poiName: '',
  metric: null,
  rows: [],
  loading: false,
  error: '',
};

const addDays = (date, days) => {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
};

const formatValue = (value, type) => {
  const numericValue = Number(value || 0);
  if (type === 'percent') {
    return `${numericValue.toFixed(2)}%`;
  }
  if (type === 'currency') {
    return `¥${numericValue.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return numericValue.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
};

const formatChange = (change) => {
  if (change === null || change === undefined) {
    return '无对比';
  }
  if (!Number.isFinite(change)) {
    return '无对比';
  }
  return `${change > 0 ? '+' : ''}${change.toFixed(2)}%`;
};

const getChangeClassName = (change) => {
  if (!Number.isFinite(change) || change === 0) {
    return 'poi-change is-neutral';
  }
  return change > 0 ? 'poi-change is-up' : 'poi-change is-down';
};

const getChangeIcon = (change) => {
  if (!Number.isFinite(change) || change === 0) {
    return <Minus size={13} />;
  }
  return change > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />;
};

const calculateChange = (currentValue, previousValue) => {
  const current = Number(currentValue || 0);
  const previous = Number(previousValue || 0);
  if (previous === 0) {
    return current > 0 ? 100 : null;
  }
  return ((current - previous) / previous) * 100;
};

const rankRows = (rows, metricKey, direction = 'desc') => {
  const sortedRows = [...rows].sort((left, right) => {
    const leftValue = Number(left[`${metricKey}_total`] || 0);
    const rightValue = Number(right[`${metricKey}_total`] || 0);
    return direction === 'desc' ? rightValue - leftValue : leftValue - rightValue;
  });

  let previousValue = null;
  let currentRank = 0;
  return sortedRows.map((row, index) => {
    const value = Number(row[`${metricKey}_total`] || 0);
    if (previousValue === null || value !== previousValue) {
      currentRank = index + 1;
      previousValue = value;
    }
    return { ...row, rank: currentRank, metricValue: value };
  });
};

const buildRankingRows = (rows, previousRowsByKey, metric, direction) => rankRows(rows, metric.key, direction)
  .slice(0, RANK_LIMIT)
  .map((row) => {
    const previousRow = previousRowsByKey.get(row.group_key);
    const previousValue = previousRow ? previousRow[`${metric.key}_total`] : 0;
    return {
      key: row.group_key,
      name: row.group_name,
      rank: row.rank,
      value: row.metricValue,
      change: calculateChange(row.metricValue, previousValue),
    };
  });

const buildCompositeRows = (rows, metrics) => {
  const rankSumByKey = new Map();
  const rowByKey = new Map(rows.map((row) => [row.group_key, row]));

  metrics.forEach((metric) => {
    rankRows(rows, metric.key, 'desc').forEach((rankedRow) => {
      rankSumByKey.set(
        rankedRow.group_key,
        (rankSumByKey.get(rankedRow.group_key) || 0) + rankedRow.rank,
      );
    });
  });

  const compositeRows = Array.from(rankSumByKey, ([groupKey, rankSum]) => ({
    key: groupKey,
    name: rowByKey.get(groupKey)?.group_name || groupKey,
    score: rankSum / metrics.length,
  })).sort((left, right) => left.score - right.score);

  let previousScore = null;
  let currentRank = 0;
  return compositeRows.slice(0, RANK_LIMIT).map((row, index) => {
    if (previousScore === null || row.score !== previousScore) {
      currentRank = index + 1;
      previousScore = row.score;
    }
    return { ...row, rank: currentRank };
  });
};

const buildTrendOption = ({ metric, trendRows, trendDates, groupNames }) => {
  const valueByGroupDate = new Map();
  trendRows.forEach((row) => {
    valueByGroupDate.set(`${row.group_key}::${row.date}`, Number(row.value || 0));
  });

  const groups = Array.from(groupNames.entries());
  return {
    title: {
      text: `${metric.label} 趋势`,
      textStyle: { fontSize: 14, color: 'var(--text-main)', fontWeight: 'normal' },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.94)',
      borderColor: 'var(--glass-border)',
      valueFormatter: (value) => formatValue(value, metric.type),
    },
    legend: {
      type: 'scroll',
      top: 0,
      right: 0,
      width: '58%',
      data: groups.map(([, name]) => name),
      textStyle: { color: 'var(--text-muted)' },
    },
    grid: { left: '3%', right: '4%', bottom: '5%', top: '48px', containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: trendDates,
      axisLabel: { color: 'var(--text-muted)' },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: 'var(--text-muted)',
        formatter: (value) => metric.type === 'percent' ? `${value}%` : value,
      },
      splitLine: { lineStyle: { color: 'var(--glass-border)' } },
    },
    series: groups.map(([groupKey, groupName]) => ({
      name: groupName,
      type: 'line',
      smooth: true,
      symbolSize: 7,
      data: trendDates.map((date) => valueByGroupDate.get(`${groupKey}::${date}`) ?? 0),
      emphasis: { focus: 'series' },
    })),
  };
};

function RankingTable({ title, rows, metric, onRowClick }) {
  return (
    <div className="poi-ranking-table">
      <div className="poi-ranking-table-title">{title}</div>
      {rows.length > 0 ? (
        <div className="poi-ranking-list">
          {rows.map((row) => (
            <button
              type="button"
              className="poi-ranking-row"
              key={`${title}-${row.key}`}
              onClick={() => onRowClick(row, metric)}
              title={`查看 ${row.name} 的商品明细`}
            >
              <div className="poi-ranking-main">
                <span className="poi-rank-badge">{row.rank}</span>
                <span className="poi-ranking-name" title={row.name}>{row.name}</span>
              </div>
              <div className="poi-ranking-side">
                <span className="poi-ranking-value">{formatValue(row.value, metric.type)}</span>
                <span className={getChangeClassName(row.change)}>
                  {getChangeIcon(row.change)}
                  {formatChange(row.change)}
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="poi-empty">暂无数据</div>
      )}
    </div>
  );
}

function POIInsight() {
  const { module } = useParams();
  const config = MODULE_CONFIGS[module];
  const [dates, setDates] = useState([]);
  const [dateStatus, setDateStatus] = useState({});
  const [pickerStartDate, setPickerStartDate] = useState(null);
  const [pickerEndDate, setPickerEndDate] = useState(null);
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [currentRows, setCurrentRows] = useState([]);
  const [previousRows, setPreviousRows] = useState([]);
  const [trendPayloads, setTrendPayloads] = useState({});
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [detailModal, setDetailModal] = useState(INITIAL_DETAIL_MODAL);

  const renderDateStatusDay = useMemo(
    () => createDateStatusDayRenderer(dateStatus),
    [dateStatus],
  );

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const [dbDates, status] = await Promise.all([getDates(), getDateStatus()]);
        setDates(dbDates);
        setDateStatus(status);

        if (dbDates.length > 0) {
          const latest = parseStoredDate(dbDates[0]);
          setPickerStartDate(latest);
          setPickerEndDate(latest);
          setStartDate(latest);
          setEndDate(latest);
        }
      } catch (error) {
        console.error(error);
      }
    };

    bootstrap();
  }, []);

  useEffect(() => {
    if (!config || !startDate || !endDate) {
      return;
    }

    const fetchInsight = async () => {
      const { startKey, endKey } = formatDateRangeKeys(startDate, endDate);
      const dayCount = getInclusiveDayCount(startDate, endDate);
      const previousEndDate = addDays(startDate, -1);
      const previousStartDate = addDays(previousEndDate, -(dayCount - 1));
      const { startKey: previousStartKey, endKey: previousEndKey } = formatDateRangeKeys(previousStartDate, previousEndDate);
      const metricKeys = config.metrics.map((metric) => metric.key);
      const poiFilter = { mode: 'poi', values: [] };

      setLoading(true);
      setErrorMessage('');
      try {
        const [currentAggregate, previousAggregate] = await Promise.all([
          getCompareAggregate(startKey, endKey, poiFilter, metricKeys),
          getCompareAggregate(previousStartKey, previousEndKey, poiFilter, metricKeys),
        ]);
        const nextCurrentRows = currentAggregate.rows || [];
        const nextPreviousRows = previousAggregate.rows || [];

        const trendEntries = await Promise.all(config.metrics.map(async (metric) => {
          const topRows = rankRows(nextCurrentRows, metric.key, 'desc').slice(0, TREND_LIMIT);
          const topKeys = topRows.map((row) => row.group_key);
          if (topKeys.length === 0) {
            return [metric.key, { dates: [], rows: [], groupNames: new Map() }];
          }

          const trendResponse = await getCompareTrend(startKey, endKey, metric.key, {
            mode: 'poi',
            values: topKeys,
          });
          return [
            metric.key,
            {
              dates: trendResponse.dates || [],
              rows: trendResponse.rows || [],
              groupNames: new Map(topRows.map((row) => [row.group_key, row.group_name])),
            },
          ];
        }));

        setCurrentRows(nextCurrentRows);
        setPreviousRows(nextPreviousRows);
        setTrendPayloads(Object.fromEntries(trendEntries));
      } catch (error) {
        console.error(error);
        setCurrentRows([]);
        setPreviousRows([]);
        setTrendPayloads({});
        setErrorMessage(error.response?.data?.detail || error.message || '数据加载失败，请稍后重试。');
      } finally {
        setLoading(false);
      }
    };

    fetchInsight();
  }, [config, endDate, startDate]);

  useEffect(() => {
    setDetailModal(INITIAL_DETAIL_MODAL);
  }, [module, endDate, startDate]);

  const previousRowsByKey = useMemo(
    () => new Map(previousRows.map((row) => [row.group_key, row])),
    [previousRows],
  );

  const rankingGroups = useMemo(() => {
    if (!config) {
      return [];
    }

    return config.metrics.map((metric) => ({
      metric,
      topRows: buildRankingRows(currentRows, previousRowsByKey, metric, 'desc'),
      bottomRows: buildRankingRows(currentRows, previousRowsByKey, metric, 'asc'),
    }));
  }, [config, currentRows, previousRowsByKey]);

  const compositeRows = useMemo(
    () => config ? buildCompositeRows(currentRows, config.metrics) : [],
    [config, currentRows],
  );

  const handleDateRangeChange = (update) => {
    const [start, end] = update;
    if (!start) {
      return;
    }
    setPickerStartDate(start);
    setPickerEndDate(end);
    setStartDate(start);
    setEndDate(end || start);
  };

  const handleCloseDetailModal = () => {
    setDetailModal(INITIAL_DETAIL_MODAL);
  };

  const handleOpenPoiDetail = async (row, metric) => {
    if (!startDate || !endDate) {
      return;
    }

    const { startKey, endKey } = formatDateRangeKeys(startDate, endDate);
    setDetailModal({
      isOpen: true,
      poiKey: row.key,
      poiName: row.name,
      metric,
      rows: [],
      loading: true,
      error: '',
    });

    try {
      const response = await getPoiProductMetricBreakdown(startKey, endKey, row.key, [metric.key]);
      const rankedRows = rankRows(response.rows || [], metric.key, 'desc').map((productRow) => ({
        key: productRow.group_key,
        name: productRow.group_name,
        productId: productRow.product_id || productRow.group_key,
        rank: productRow.rank,
        value: productRow.metricValue,
      }));

      setDetailModal((currentModal) => {
        if (
          !currentModal.isOpen
          || currentModal.poiKey !== row.key
          || currentModal.metric?.key !== metric.key
        ) {
          return currentModal;
        }

        return {
          ...currentModal,
          rows: rankedRows,
          loading: false,
        };
      });
    } catch (error) {
      console.error(error);
      setDetailModal((currentModal) => {
        if (
          !currentModal.isOpen
          || currentModal.poiKey !== row.key
          || currentModal.metric?.key !== metric.key
        ) {
          return currentModal;
        }

        return {
          ...currentModal,
          rows: [],
          loading: false,
          error: error.response?.data?.detail || error.message || '商品明细加载失败，请稍后重试。',
        };
      });
    }
  };

  if (!config) {
    return <Navigate to="/dashboard" replace />;
  }

  if (!dates.length) {
    return (
      <div className="glass-panel poi-empty-state">
        暂无数据，请先上传商品数据和利润数据。
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{config.title}</h1>
      </div>

      <div className="glass-panel mb-32 poi-date-filter-panel">
        <div className="mobile-date-row poi-filter-bar">
          <div className="input-group status-datepicker-wrapper is-compare mobile-full-width">
            <label className="input-label">分析日期范围</label>
            <DatePicker
              selectsRange
              startDate={pickerStartDate}
              endDate={pickerEndDate}
              onChange={handleDateRangeChange}
              dateFormat="yyyy-MM-dd"
              locale="zh-CN"
              isClearable={false}
              placeholderText="请选择开始和结束日期"
              showPopperArrow={false}
              className="input"
              renderDayContents={renderDateStatusDay}
            />
          </div>
          <div className="poi-range-summary">
            <span>当前区间</span>
            <strong>{startDate ? formatDateKey(startDate) : '--'} 至 {endDate ? formatDateKey(endDate) : '--'}</strong>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="glass-panel poi-empty-state">加载中...</div>
      ) : errorMessage ? (
        <div className="glass-panel poi-empty-state">{errorMessage}</div>
      ) : (
        <>
          <div className="poi-ranking-grid">
            {rankingGroups.map(({ metric, topRows, bottomRows }) => (
              <section className="glass-panel poi-metric-card" key={metric.key}>
                <h3>{metric.label}</h3>
                <div className="poi-dual-ranking">
                  <RankingTable
                    title="前五 POI"
                    rows={topRows}
                    metric={metric}
                    onRowClick={handleOpenPoiDetail}
                  />
                  <RankingTable
                    title="倒数五 POI"
                    rows={bottomRows}
                    metric={metric}
                    onRowClick={handleOpenPoiDetail}
                  />
                </div>
              </section>
            ))}
          </div>

          <div className="poi-chart-grid mb-32">
            {config.metrics.map((metric) => {
              const trendPayload = trendPayloads[metric.key] || { dates: [], rows: [], groupNames: new Map() };
              const chartOption = buildTrendOption({
                metric,
                trendRows: trendPayload.rows,
                trendDates: trendPayload.dates,
                groupNames: trendPayload.groupNames,
              });

              return (
                <div className="chart-container poi-chart-panel" key={`${metric.key}-trend`}>
                  {trendPayload.rows.length > 0 ? (
                    <ReactEChartsCore echarts={echarts} option={chartOption} style={{ height: '100%' }} opts={{ renderer: 'svg' }} />
                  ) : (
                    <div className="poi-empty">暂无趋势数据</div>
                  )}
                </div>
              );
            })}
          </div>

          <section className="glass-panel poi-composite-card">
            <div className="poi-composite-title">
              <Trophy size={18} color="var(--accent)" />
              <h3>{config.compositeTitle}</h3>
            </div>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>综合排名</th>
                    <th>POI</th>
                    <th>平均排名</th>
                  </tr>
                </thead>
                <tbody>
                  {compositeRows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.rank}</td>
                      <td>{row.name}</td>
                      <td>{row.score.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {detailModal.isOpen && (
        <div className="poi-modal-backdrop" onClick={handleCloseDetailModal}>
          <div
            className="poi-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="poi-detail-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="poi-detail-modal-header">
              <div>
                <span className="poi-detail-eyebrow">POI 商品明细</span>
                <h2 id="poi-detail-modal-title">{detailModal.poiName}</h2>
                <p>
                  {detailModal.metric?.label || '--'}
                  {' · '}
                  {startDate ? formatDateKey(startDate) : '--'}
                  {' 至 '}
                  {endDate ? formatDateKey(endDate) : '--'}
                </p>
              </div>
              <button
                type="button"
                className="poi-detail-close"
                onClick={handleCloseDetailModal}
                aria-label="关闭商品明细"
              >
                <X size={20} />
              </button>
            </div>

            <div className="poi-detail-modal-body">
              {detailModal.loading ? (
                <div className="poi-empty poi-detail-message">商品明细加载中...</div>
              ) : detailModal.error ? (
                <div className="poi-empty poi-detail-message">{detailModal.error}</div>
              ) : detailModal.rows.length > 0 ? (
                <div className="data-table-wrapper poi-detail-table-wrapper">
                  <table className="data-table poi-detail-table">
                    <thead>
                      <tr>
                        <th>排名</th>
                        <th>商品</th>
                        <th>商品 ID</th>
                        <th>{detailModal.metric?.label || '指标值'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailModal.rows.map((productRow) => (
                        <tr key={productRow.key}>
                          <td>{productRow.rank}</td>
                          <td className="poi-detail-product-name" title={productRow.name}>
                            {productRow.name}
                          </td>
                          <td>{productRow.productId}</td>
                          <td>{formatValue(productRow.value, detailModal.metric?.type)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="poi-empty poi-detail-message">暂无商品明细数据</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default POIInsight;
