export const ALL_METRICS = {
  visitor_count: '访客数',
  bounce_rate: '商品详情页跳出率',
  pay_amount: '支付金额',
  pay_share: '支付占比',
  profit: '商品利润',
  profit_share: '利润占比',
  pay_conversion: '支付转化率',
  refund_rate_amount: '成功退款率(金额)',
  refund_share: '退款占比',
  redeem_rate_amount: '核销率(金额)',
  redeem_share: '核销占比',
  live_pay_amount: '店播支付金额',
  price_multiplier: '价格倍数',
  page_views: '浏览量',
  avg_visitor_value: '访客平均价值',
  order_users: '下单用户数',
  order_amount: '下单金额',
  order_conversion: '下单转化率',
  pay_users: '支付用户数',
  pay_orders: '支付订单数',
  pay_items: '支付件数',
  order_user_pay_rate: '下单用户支付率',
  silent_pay_conversion: '静默支付转化率',
  refund_items: '成功退款件数',
  refund_amount: '成功退款金额',
  refund_rate_item: '成功退款率(件数)',
  redeem_items: '核销件数',
  redeem_amount: '核销金额',
  redeem_rate_item: '核销率(件数)',
  live_pay_orders: '店播支付订单量',
  live_pay_users: '店播支付用户数',
  live_pay_coupons: '店播支付券量',
  live_consume_amount: '店播消费金额',
  live_consume_coupons: '店播消费券量',
  live_consume_orders: '店播消费订单量',
  live_refund_amount: '店播退款金额',
  live_consume_rate: '店播消费率',
  live_refund_rate: '店播退款率',
};

export const METRIC_KEYS = Object.keys(ALL_METRICS);

export const PERCENT_METRICS = new Set([
  'bounce_rate',
  'pay_conversion',
  'refund_rate_amount',
  'refund_rate_item',
  'redeem_rate_amount',
  'redeem_rate_item',
  'order_conversion',
  'order_user_pay_rate',
  'silent_pay_conversion',
  'live_consume_rate',
  'live_refund_rate',
  'profit_share',
  'refund_share',
  'pay_share',
  'redeem_share',
]);

export const CURRENCY_METRICS = new Set([
  'pay_amount',
  'profit',
  'refund_amount',
  'redeem_amount',
  'live_pay_amount',
  'order_amount',
  'live_consume_amount',
  'live_refund_amount',
  'avg_visitor_value',
]);

export const formatMetricNumber = (value) => Number(value || 0).toFixed(2);

export const formatMetricValue = (metric, value) => {
  if (PERCENT_METRICS.has(metric)) {
    return `${formatMetricNumber(value)}%`;
  }
  if (CURRENCY_METRICS.has(metric)) {
    return `¥${Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
};
