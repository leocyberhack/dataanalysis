import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

const formatCurrency = (value) => `¥${(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatNumber = (value) => `${(value || 0).toLocaleString()}`;
const formatPercent = (value) => `${(value || 0).toFixed(2)}%`;

const getMetricGroups = (prefix) => [
  [
    { key: 'profit', title: `${prefix}总利润`, formatter: formatCurrency },
    { key: 'profit_margin', title: '利润率', formatter: formatPercent },
    { key: 'pay_amount', title: `${prefix}总支付金额`, formatter: formatCurrency },
    { key: 'pay_orders', title: '支付订单数', formatter: formatNumber },
  ],
  [
    { key: 'redeem_amount', title: '总核销金额', formatter: formatCurrency },
    { key: 'redeem_rate_amount', title: '核销率(金额)', formatter: formatPercent },
    { key: 'redeem_items', title: '核销件数', formatter: formatNumber },
    { key: 'redeem_rate_item', title: '核销率(件数)', formatter: formatPercent },
  ],
  [
    { key: 'refund_rate_amount', title: '成功退款率(金额)', formatter: formatPercent },
    { key: 'refund_rate_item', title: '成功退款率(件数)', formatter: formatPercent },
  ],
];

function SummaryMetricsGrid({ summary, prefix, className = '' }) {
  if (!summary?.today) {
    return null;
  }

  const renderMetric = ({ key, title, formatter }) => {
    const value = summary.today[key];
    const change = summary.changes ? summary.changes[key] : null;
    const hasYesterday = summary.has_yesterday;

    return (
      <div className="glass-panel metric-card" key={key}>
        <div className="metric-title">{title}</div>
        <div className="metric-value">{formatter(value)}</div>
        <div className="metric-change">
          {!hasYesterday ? (
            <span className="change-neutral">上一周期暂无数据</span>
          ) : change === null || change === undefined ? (
            <span className="change-neutral"><Minus size={14} /> 0.00%</span>
          ) : change > 0 ? (
            <span className="change-up"><ArrowUpRight size={14} /> +{change.toFixed(2)}%</span>
          ) : change < 0 ? (
            <span className="change-down"><ArrowDownRight size={14} /> {change.toFixed(2)}%</span>
          ) : (
            <span className="change-neutral"><Minus size={14} /> 0.00%</span>
          )}
        </div>
      </div>
    );
  };

  const metricGroups = getMetricGroups(prefix);

  return (
    <div className={className}>
      {metricGroups.map((group, index) => (
        <div className="metrics-grid" style={{ marginBottom: index === metricGroups.length - 1 ? '40px' : '24px' }} key={index}>
          {group.map(renderMetric)}
        </div>
      ))}
    </div>
  );
}

export default SummaryMetricsGrid;
