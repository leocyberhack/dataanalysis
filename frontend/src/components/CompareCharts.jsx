import { memo, useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { echarts } from '../lib/echarts';

const truncateLabel = (value, limit) => (
  value.length > limit ? `${value.substring(0, limit)}...` : value
);

function CompareCharts({ aggregatedRows, rawData, trendDates, selectedMetrics, metricLabels }) {
  const activeMetric = selectedMetrics.length === 1 ? selectedMetrics[0] : '';

  const lineChartModel = useMemo(() => {
    if (!rawData.length || !activeMetric) {
      return null;
    }

    const rankedProducts = [...aggregatedRows]
      .sort((left, right) => (right[`${activeMetric}_total`] || 0) - (left[`${activeMetric}_total`] || 0))
      .slice(0, 5);
    const xAxisDates = trendDates?.length
      ? trendDates
      : Array.from(new Set(rawData.map((row) => row.date))).sort();
    const rankedProductById = new Map(
      rankedProducts.map((row) => [row.product_id, row]),
    );
    const valueByProductDate = new Map();

    rawData.forEach((row) => {
      if (rankedProductById.has(row.product_id)) {
        valueByProductDate.set(`${row.product_id}::${row.date}`, Number.parseFloat(row.value || 0));
      }
    });

    const legend = [];
    const series = rankedProducts.map((product) => {
      const shortName = truncateLabel(product.product_name || product.product_id, 8);
      legend.push(shortName);

      return {
        name: shortName,
        type: 'line',
        smooth: true,
        symbolSize: 8,
        data: xAxisDates.map((date) => valueByProductDate.get(`${product.product_id}::${date}`) ?? 0),
        emphasis: { focus: 'series' },
      };
    });

    return { legend, series, xAxisDates };
  }, [activeMetric, aggregatedRows, rawData, trendDates]);

  const topAverageRows = useMemo(() => {
    if (!activeMetric) {
      return [];
    }

    return [...aggregatedRows]
      .sort((left, right) => (right[`${activeMetric}_avg`] || 0) - (left[`${activeMetric}_avg`] || 0))
      .slice(0, 10);
  }, [activeMetric, aggregatedRows]);

  const topTotalRows = useMemo(() => {
    if (!activeMetric) {
      return [];
    }

    return [...aggregatedRows]
      .sort((left, right) => (right[`${activeMetric}_total`] || 0) - (left[`${activeMetric}_total`] || 0))
      .slice(0, 10);
  }, [activeMetric, aggregatedRows]);

  const lineChartOption = useMemo(() => {
    if (!lineChartModel || !activeMetric) {
      return null;
    }

    return {
      title: {
        text: `趋势：${metricLabels[activeMetric]}`,
        textStyle: { fontSize: 14, color: 'var(--text-main)', fontWeight: 'normal' },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(255,255,255,0.92)',
        borderColor: 'var(--glass-border)',
      },
      legend: {
        data: lineChartModel.legend,
        textStyle: { color: 'var(--text-muted)' },
        type: 'scroll',
        top: 0,
        right: 0,
        width: '60%',
      },
      grid: { left: '3%', right: '4%', bottom: '5%', top: '40px', containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: lineChartModel.xAxisDates,
        axisLabel: { color: 'var(--text-muted)' },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: 'var(--text-muted)' },
        splitLine: { lineStyle: { color: 'var(--glass-border)' } },
      },
      series: lineChartModel.series,
    };
  }, [activeMetric, lineChartModel, metricLabels]);

  const barChartOption = useMemo(() => {
    if (!topAverageRows.length || !activeMetric) {
      return null;
    }

    return {
      title: {
        text: `TOP 10：${metricLabels[activeMetric]}（区间日均）`,
        textStyle: { fontSize: 14, color: 'var(--text-main)', fontWeight: 'normal' },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: 'rgba(255,255,255,0.92)',
      },
      grid: { left: '3%', right: '4%', bottom: '5%', top: '40px', containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { color: 'var(--text-muted)' },
        splitLine: { lineStyle: { color: 'var(--glass-border)' } },
      },
      yAxis: {
        type: 'category',
        data: topAverageRows.map((item) => truncateLabel(item.product_name || item.product_id, 6)).reverse(),
        axisLabel: { color: 'var(--text-muted)' },
      },
      series: [
        {
          name: metricLabels[activeMetric],
          type: 'bar',
          data: topAverageRows.map((item) => item[`${activeMetric}_avg`] || 0).reverse(),
          itemStyle: { borderRadius: [0, 4, 4, 0], color: 'var(--accent)' },
        },
      ],
    };
  }, [activeMetric, metricLabels, topAverageRows]);

  const pieChartOption = useMemo(() => {
    if (!topTotalRows.length || !activeMetric) {
      return null;
    }

    return {
      title: {
        text: `${metricLabels[activeMetric]} 总计占比（Top 10）`,
        left: 'center',
        textStyle: { fontSize: 14, color: 'var(--text-main)', fontWeight: 'normal' },
      },
      tooltip: { trigger: 'item', backgroundColor: 'rgba(255,255,255,0.92)' },
      legend: { show: false },
      series: [
        {
          name: metricLabels[activeMetric],
          type: 'pie',
          radius: ['40%', '70%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 10,
            borderColor: 'rgba(255,255,255,0.85)',
            borderWidth: 2,
          },
          label: { show: true, color: 'var(--text-muted)', formatter: '{b}\n{d}%' },
          data: topTotalRows.map((item) => ({
            value: item[`${activeMetric}_total`] || 0,
            name: truncateLabel(item.product_name || item.product_id, 10),
          })),
        },
      ],
    };
  }, [activeMetric, metricLabels, topTotalRows]);

  if (!activeMetric || !lineChartOption || !barChartOption || !pieChartOption) {
    return null;
  }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '24px', marginBottom: '24px' }}>
        <div className="chart-container compare-chart-panel">
          <ReactEChartsCore echarts={echarts} option={lineChartOption} style={{ height: '100%' }} opts={{ renderer: 'svg' }} />
        </div>
      </div>

      <div className="mobile-chart-grid compare-chart-grid">
        <div className="chart-container compare-chart-panel">
          <ReactEChartsCore echarts={echarts} option={pieChartOption} style={{ height: '100%' }} opts={{ renderer: 'svg' }} />
        </div>
        <div className="chart-container compare-chart-panel">
          <ReactEChartsCore echarts={echarts} option={barChartOption} style={{ height: '100%' }} opts={{ renderer: 'svg' }} />
        </div>
      </div>
    </>
  );
}

export default memo(CompareCharts);
