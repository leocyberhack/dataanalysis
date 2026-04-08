import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';
import DatePicker, { registerLocale } from 'react-datepicker';
import { zhCN } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import {
  getCompareAggregate,
  getDateStatus,
  getDetailedData,
  getDates,
  getProducts,
  getSummary,
} from '../api';
import SummaryMetricsGrid from '../components/SummaryMetricsGrid';

registerLocale('zh-CN', zhCN);

const ALL_METRICS = {
  visitor_count: '访客数',
  bounce_rate: '商品详情页跳出率',
  pay_amount: '支付金额',
  profit: '商品利润',
  pay_conversion: '支付转化率',
  refund_rate_amount: '成功退款率(金额)',
  redeem_rate_amount: '核销率(金额)',
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

const DEFAULT_METRICS = ['pay_amount'];
const METRIC_KEYS = Object.keys(ALL_METRICS);

const normalizeSearchText = (value) => value.toLowerCase().replace(/\s+/g, '');
const formatTableNumber = (value) => Number(value || 0).toFixed(2);

const Compare = () => {
  const [dates, setDates] = useState([]);
  const [products, setProducts] = useState([]);
  const [dateStatus, setDateStatus] = useState({});

  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [pickerStartDate, setPickerStartDate] = useState(null);
  const [pickerEndDate, setPickerEndDate] = useState(null);

  const [selectedProducts, setSelectedProducts] = useState([]);
  const [selectedMetrics, setSelectedMetrics] = useState(DEFAULT_METRICS);
  const [productSearch, setProductSearch] = useState('');
  const [metricSearch, setMetricSearch] = useState('');

  const [rawData, setRawData] = useState([]);
  const [aggregatedRows, setAggregatedRows] = useState([]);
  const [overallTotals, setOverallTotals] = useState({});
  const [comparisonSummary, setComparisonSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [sortMetric, setSortMetric] = useState('');
  const [sortOrder, setSortOrder] = useState('desc');

  const tableWrapperRef = useRef(null);
  const topScrollWrapperRef = useRef(null);
  const previousProductIdsRef = useRef([]);
  const [tableScrollWidth, setTableScrollWidth] = useState('100%');

  const selectedRangeDayCount = useMemo(() => {
    if (!startDate || !endDate) {
      return 1;
    }

    const start = dayjs(startDate).startOf('day');
    const end = dayjs(endDate).startOf('day');
    const diffDays = end.diff(start, 'day');
    return diffDays >= 0 ? diffDays + 1 : 1;
  }, [endDate, startDate]);

  const productOptions = useMemo(
    () => products.map((product) => ({ value: product.id, label: product.name })),
    [products],
  );

  const metricOptions = useMemo(
    () => METRIC_KEYS.map((metric) => ({ value: metric, label: ALL_METRICS[metric] })),
    [],
  );

  const filteredProductOptions = useMemo(() => {
    const keyword = normalizeSearchText(productSearch);
    if (!keyword) {
      return productOptions;
    }
    return productOptions.filter((option) => normalizeSearchText(`${option.label}${option.value}`).includes(keyword));
  }, [productOptions, productSearch]);

  const filteredMetricOptions = useMemo(() => {
    const keyword = normalizeSearchText(metricSearch);
    if (!keyword) {
      return metricOptions;
    }
    return metricOptions.filter((option) => normalizeSearchText(`${option.label}${option.value}`).includes(keyword));
  }, [metricOptions, metricSearch]);

  const allFilteredProductsSelected = filteredProductOptions.length > 0
    && filteredProductOptions.every((option) => selectedProducts.includes(option.value));
  const allFilteredMetricsSelected = filteredMetricOptions.length > 0
    && filteredMetricOptions.every((option) => selectedMetrics.includes(option.value));

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const [dbDates, status] = await Promise.all([getDates(), getDateStatus()]);
        setDates(dbDates);
        setDateStatus(status);

        const fallbackDate = dbDates.length > 0 ? dayjs(dbDates[0]).toDate() : dayjs().toDate();
        setStartDate(fallbackDate);
        setEndDate(fallbackDate);
        setPickerStartDate(fallbackDate);
        setPickerEndDate(fallbackDate);
      } catch (error) {
        console.error(error);
      }
    };

    bootstrap();
  }, []);

  useEffect(() => {
    if (!startDate || !endDate) {
      return;
    }

    const startStr = dayjs(startDate).format('YYYY-MM-DD');
    const endStr = dayjs(endDate).format('YYYY-MM-DD');

    getProducts(startStr, endStr)
      .then((nextProducts) => {
        const previousProductIds = previousProductIdsRef.current;
        const nextProductIds = nextProducts.map((product) => product.id);
        previousProductIdsRef.current = nextProductIds;
        setProducts(nextProducts);
        setSelectedProducts((previousSelection) => {
          const previousAllSelected = previousProductIds.length > 0
            && previousSelection.length === previousProductIds.length
            && previousSelection.every((id) => previousProductIds.includes(id));
          const validSelection = previousSelection.filter((id) => nextProductIds.includes(id));

          if (previousSelection.length === 0 || previousAllSelected || validSelection.length === 0) {
            return nextProductIds;
          }

          return validSelection;
        });
      })
      .catch(console.error);
  }, [endDate, startDate]);

  useEffect(() => {
    setHasGenerated(false);
    setErrorMessage('');
    setRawData([]);
    setAggregatedRows([]);
    setOverallTotals({});
    setComparisonSummary(null);
  }, [endDate, selectedProducts, startDate]);

  useEffect(() => {
    if (!sortMetric) {
      return;
    }

    const isMetricStillVisible = selectedMetrics.some((metric) => sortMetric.startsWith(`${metric}_`));
    if (!isMetricStillVisible) {
      setSortMetric('');
      setSortOrder('desc');
    }
  }, [selectedMetrics, sortMetric]);

  useEffect(() => {
    const updateWidth = () => {
      if (tableWrapperRef.current) {
        setTableScrollWidth(`${tableWrapperRef.current.scrollWidth}px`);
      }
    };

    const timer = setTimeout(updateWidth, 100);
    window.addEventListener('resize', updateWidth);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateWidth);
    };
  }, [aggregatedRows, selectedMetrics]);

  const sortedData = useMemo(() => {
    const tableData = [...aggregatedRows];
    if (!sortMetric) {
      return tableData;
    }

    tableData.sort((left, right) => {
      const leftValue = left[sortMetric] || 0;
      const rightValue = right[sortMetric] || 0;
      return sortOrder === 'desc' ? rightValue - leftValue : leftValue - rightValue;
    });
    return tableData;
  }, [aggregatedRows, sortMetric, sortOrder]);

  const lineChartModel = useMemo(() => {
    if (!rawData.length || selectedMetrics.length !== 1) {
      return null;
    }

    const activeMetric = selectedMetrics[0];
    const rankedProducts = [...aggregatedRows]
      .sort((left, right) => (right[`${activeMetric}_total`] || 0) - (left[`${activeMetric}_total`] || 0))
      .slice(0, 5);
    const displayProductIds = rankedProducts.map((row) => row.product_id);
    const xAxisDates = Array.from(new Set(rawData.map((row) => row.date))).sort();
    const valueByProductDate = new Map();

    rawData.forEach((row) => {
      valueByProductDate.set(`${row.product_id}::${row.date}`, parseFloat(row[activeMetric] || 0));
    });

    const legend = [];
    const series = displayProductIds.map((productId) => {
      const product = rankedProducts.find((row) => row.product_id === productId);
      const productName = product?.product_name || productId;
      const shortName = productName.length > 8 ? `${productName.substring(0, 8)}...` : productName;
      legend.push(shortName);

      return {
        name: shortName,
        type: 'line',
        smooth: true,
        symbolSize: 8,
        data: xAxisDates.map((date) => valueByProductDate.get(`${productId}::${date}`) ?? 0),
        emphasis: { focus: 'series' },
      };
    });

    return { activeMetric, legend, series, xAxisDates };
  }, [aggregatedRows, rawData, selectedMetrics]);

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

  const handleToggleOption = (value, setter, selectedValues) => {
    setter(
      selectedValues.includes(value)
        ? selectedValues.filter((item) => item !== value)
        : [...selectedValues, value],
    );
  };

  const handleToggleAllProducts = () => {
    const filteredIds = filteredProductOptions.map((option) => option.value);
    if (allFilteredProductsSelected) {
      setSelectedProducts((previous) => previous.filter((id) => !filteredIds.includes(id)));
      return;
    }
    setSelectedProducts((previous) => [...new Set([...previous, ...filteredIds])]);
  };

  const handleToggleAllMetrics = () => {
    const filteredIds = filteredMetricOptions.map((option) => option.value);
    if (allFilteredMetricsSelected) {
      setSelectedMetrics((previous) => previous.filter((id) => !filteredIds.includes(id)));
      return;
    }
    setSelectedMetrics((previous) => [...new Set([...previous, ...filteredIds])]);
  };

  const getLineChartOption = () => {
    if (!lineChartModel) {
      return {};
    }

    const { activeMetric, legend, series, xAxisDates } = lineChartModel;
    return {
      title: {
        text: `趋势：${ALL_METRICS[activeMetric]}`,
        textStyle: { fontSize: 14, color: 'var(--text-main)', fontWeight: 'normal' },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(255,255,255,0.92)',
        borderColor: 'var(--glass-border)',
      },
      legend: {
        data: legend,
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
        data: xAxisDates,
        axisLabel: { color: 'var(--text-muted)' },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: 'var(--text-muted)' },
        splitLine: { lineStyle: { color: 'var(--glass-border)' } },
      },
      series,
    };
  };

  const getBarChartOption = () => {
    if (!aggregatedRows.length || selectedMetrics.length !== 1) {
      return {};
    }

    const activeMetric = selectedMetrics[0];
    const top10 = [...aggregatedRows]
      .sort((left, right) => (right[`${activeMetric}_avg`] || 0) - (left[`${activeMetric}_avg`] || 0))
      .slice(0, 10);

    return {
      title: {
        text: `TOP 10：${ALL_METRICS[activeMetric]}（区间日均）`,
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
        data: top10.map((item) => (item.product_name.length > 6 ? `${item.product_name.substring(0, 6)}...` : item.product_name)).reverse(),
        axisLabel: { color: 'var(--text-muted)' },
      },
      series: [
        {
          name: ALL_METRICS[activeMetric],
          type: 'bar',
          data: top10.map((item) => item[`${activeMetric}_avg`] || 0).reverse(),
          itemStyle: { borderRadius: [0, 4, 4, 0], color: 'var(--accent)' },
        },
      ],
    };
  };

  const getPieChartOption = () => {
    if (!aggregatedRows.length || selectedMetrics.length !== 1) {
      return {};
    }

    const activeMetric = selectedMetrics[0];
    const top10 = [...aggregatedRows]
      .sort((left, right) => (right[`${activeMetric}_total`] || 0) - (left[`${activeMetric}_total`] || 0))
      .slice(0, 10);

    return {
      title: {
        text: `${ALL_METRICS[activeMetric]} 总计占比（Top 10）`,
        left: 'center',
        textStyle: { fontSize: 14, color: 'var(--text-main)', fontWeight: 'normal' },
      },
      tooltip: { trigger: 'item', backgroundColor: 'rgba(255,255,255,0.92)' },
      legend: { show: false },
      series: [
        {
          name: ALL_METRICS[activeMetric],
          type: 'pie',
          radius: ['40%', '70%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 10,
            borderColor: 'rgba(255,255,255,0.85)',
            borderWidth: 2,
          },
          label: { show: true, color: 'var(--text-muted)', formatter: '{b}\n{d}%' },
          data: top10.map((item) => ({
            value: item[`${activeMetric}_total`] || 0,
            name: item.product_name.length > 10 ? `${item.product_name.substring(0, 10)}...` : item.product_name,
          })),
        },
      ],
    };
  };

  const handleSearch = async () => {
    if (!startDate || !endDate || selectedProducts.length === 0 || selectedMetrics.length === 0) {
      return;
    }

    const startStr = dayjs(startDate).format('YYYY-MM-DD');
    const endStr = dayjs(endDate).format('YYYY-MM-DD');

    setLoading(true);
    setHasGenerated(true);
    setErrorMessage('');

    try {
      const [detailedData, aggregateData, summaryData] = await Promise.all([
        getDetailedData(startStr, endStr, selectedProducts),
        getCompareAggregate(startStr, endStr, selectedProducts),
        getSummary(startStr, endStr, selectedProducts),
      ]);

      setRawData(detailedData);
      setAggregatedRows(aggregateData.rows || []);
      setOverallTotals(aggregateData.overall_totals || {});
      setComparisonSummary(summaryData);
    } catch (error) {
      console.error(error);
      setRawData([]);
      setAggregatedRows([]);
      setOverallTotals({});
      setComparisonSummary(null);
      setErrorMessage(error.response?.data?.detail || error.message || '生成分析失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    const latest = dates.length > 0 ? dayjs(dates[0]).toDate() : dayjs().toDate();
    setStartDate(latest);
    setEndDate(latest);
    setPickerStartDate(latest);
    setPickerEndDate(latest);
    setSelectedProducts(products.map((product) => product.id));
    setSelectedMetrics(DEFAULT_METRICS);
    setProductSearch('');
    setMetricSearch('');
    setSortMetric('');
    setSortOrder('desc');
  };

  const handleExportExcel = async () => {
    if (!aggregatedRows.length || selectedMetrics.length === 0) {
      return;
    }

    const XLSX = await import('xlsx');
    const sheetRows = [];
    const headerRow = ['商品名称', '有数据天数/区间天数'];

    selectedMetrics.forEach((metric) => {
      headerRow.push(
        `${ALL_METRICS[metric]} - 平均值`,
        `${ALL_METRICS[metric]} - 总计`,
        `${ALL_METRICS[metric]} - 最大值`,
        `${ALL_METRICS[metric]} - 最小值`,
      );
    });
    sheetRows.push(headerRow);

    sortedData.forEach((row) => {
      const line = [row.product_name, `${row.days_count}/${selectedRangeDayCount}`];
      selectedMetrics.forEach((metric) => {
        line.push(
          row[`${metric}_avg`] || 0,
          row[`${metric}_total`] || 0,
          row[`${metric}_max`] || 0,
          row[`${metric}_min`] || 0,
        );
      });
      sheetRows.push(line);
    });

    sheetRows.push([]);
    sheetRows.push(['筛选商品总体总计']);
    sheetRows.push(['维度', '总计']);
    selectedMetrics.forEach((metric) => {
      sheetRows.push([ALL_METRICS[metric], overallTotals[metric] || 0]);
    });

    sheetRows.push([]);
    sheetRows.push(['备注']);
    sheetRows.push(['1. 平均值 = 所选区间内该商品该指标总计 ÷ 区间总天数。']);
    sheetRows.push(['2. 总计 = 所选区间内该商品该指标的累计值。']);
    sheetRows.push(['3. 最大值 / 最小值 = 所选区间内该商品在已有数据日期中的单日最大值 / 最小值。']);

    const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
    worksheet['!cols'] = [
      { wch: 24 },
      { wch: 18 },
      ...selectedMetrics.flatMap(() => [{ wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]),
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '多维分析');
    XLSX.writeFile(
      workbook,
      `多维分析_${dayjs(startDate).format('YYYY-MM-DD')}_至_${dayjs(endDate).format('YYYY-MM-DD')}.xlsx`,
    );
  };

  const handleSort = (metricKey) => {
    if (sortMetric === metricKey) {
      if (sortOrder === 'desc') {
        setSortOrder('asc');
      } else {
        setSortMetric('');
        setSortOrder('desc');
      }
      return;
    }

    setSortMetric(metricKey);
    setSortOrder('desc');
  };

  const handleTopScroll = (event) => {
    if (tableWrapperRef.current && tableWrapperRef.current.scrollLeft !== event.target.scrollLeft) {
      tableWrapperRef.current.scrollLeft = event.target.scrollLeft;
    }
  };

  const handleBottomScroll = (event) => {
    if (topScrollWrapperRef.current && topScrollWrapperRef.current.scrollLeft !== event.target.scrollLeft) {
      topScrollWrapperRef.current.scrollLeft = event.target.scrollLeft;
    }
  };

  const renderSortHeader = (label, metricKey) => {
    const isActive = sortMetric === metricKey;
    const arrow = isActive ? (sortOrder === 'desc' ? '↓' : '↑') : '↕';

    return (
      <th
        style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
        onClick={() => handleSort(metricKey)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ color: isActive ? 'var(--text-main)' : 'inherit' }}>{label}</span>
          <span style={{ fontSize: '12px', color: isActive ? 'var(--accent)' : 'var(--text-muted)', opacity: isActive ? 1 : 0.45 }}>
            {arrow}
          </span>
        </div>
      </th>
    );
  };

  const renderSelectorCard = ({
    title,
    tip,
    searchValue,
    onSearchChange,
    searchPlaceholder,
    selectedCount,
    totalCount,
    filteredCount,
    allSelected,
    onToggleAll,
    onClear,
    clearDisabled,
    options,
    selectedValues,
    setter,
    emptyText,
  }) => (
    <div className="compare-selector-card">
      <div className="compare-selector-header">
        <div>
          <div className="input-label" style={{ marginBottom: '6px' }}>{title}</div>
          <div className="compare-selector-tip">{tip}</div>
        </div>
        <div className="compare-selector-count">已选 {selectedCount} / {totalCount}</div>
      </div>

      <div className="compare-selector-toolbar">
        <input
          className="compare-selector-search"
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
        />
        <div className="compare-selector-actions">
          <button type="button" className="compare-selector-action" onClick={onToggleAll} disabled={filteredCount === 0}>
            {allSelected ? '取消全选当前结果' : '全选当前结果'}
          </button>
          <button type="button" className="compare-selector-action" onClick={onClear} disabled={clearDisabled}>
            清空
          </button>
        </div>
      </div>

      <label className="compare-master-check">
        <input type="checkbox" checked={allSelected} onChange={onToggleAll} disabled={filteredCount === 0} />
        <span>全选符合搜索条件的选项（{filteredCount}）</span>
      </label>

      <div className="compare-checkbox-list">
        {filteredCount === 0 ? (
          <div className="compare-selector-empty">{emptyText}</div>
        ) : (
          options.map((option) => {
            const checked = selectedValues.includes(option.value);
            return (
              <label className={`compare-checkbox-item ${checked ? 'is-selected' : ''}`} key={option.value}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => handleToggleOption(option.value, setter, selectedValues)}
                />
                <span className="compare-checkbox-label" title={option.label}>{option.label}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );

  const getTitlePrefix = () => {
    if (!startDate || !endDate) {
      return '当日';
    }
    const startStr = dayjs(startDate).format('YYYY-MM-DD');
    const endStr = dayjs(endDate).format('YYYY-MM-DD');
    return startStr === endStr ? '当日' : '该周期';
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">多维分析与对比</h1>
      </div>

      <div className="glass-panel mb-32">
        <style>{`
          .compare-datepicker-wrapper .react-datepicker-wrapper { width: 100%; }
          .compare-datepicker-wrapper .react-datepicker {
            font-family: inherit;
            border: 1px solid var(--glass-border);
            border-radius: 16px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            padding: 16px;
            font-size: 1.2rem;
          }
          .compare-datepicker-wrapper .react-datepicker__current-month {
            font-size: 1.5em;
            padding-bottom: 8px;
          }
          .compare-datepicker-wrapper .react-datepicker__navigation { top: 20px; }
          .compare-datepicker-wrapper .react-datepicker__navigation-icon::before {
            border-width: 3px 3px 0 0;
            height: 12px;
            width: 12px;
          }
          .compare-datepicker-wrapper .react-datepicker__day-name,
          .compare-datepicker-wrapper .react-datepicker__day,
          .compare-datepicker-wrapper .react-datepicker__time-name {
            width: 4rem;
            line-height: 4rem;
            margin: 0.2rem;
          }
          .compare-datepicker-wrapper .react-datepicker__input-container input {
            width: 100%;
            background: var(--bg-light);
            border: 1px solid var(--glass-border);
            border-radius: 8px;
            padding: 12px 16px;
            font-family: inherit;
            font-size: 15px;
            color: var(--text-main);
            outline: none;
            transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
            cursor: pointer;
          }
          .compare-datepicker-wrapper .react-datepicker__input-container input:hover {
            border-color: rgba(224, 122, 95, 0.4);
            background: rgba(255, 255, 255, 0.9);
          }
          .compare-datepicker-wrapper .react-datepicker__input-container input:focus {
            border-color: var(--accent);
            box-shadow: 0 0 0 3px rgba(224, 122, 95, 0.15);
            background: #ffffff;
          }
        `}</style>

        <div className="mobile-date-row" style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '24px' }}>
          <div className="input-group compare-datepicker-wrapper mobile-full-width" style={{ flex: '1 1 320px' }}>
            <div className="mobile-stack" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <label className="input-label">分析日期范围</label>
              <div className="mobile-tag-row" style={{ display: 'flex', gap: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#60A5FA' }} />商品数据</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#F59E0B' }} />利润数据</div>
              </div>
            </div>
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
              renderDayContents={(day, dateObj) => {
                const dateStr = dayjs(dateObj).format('YYYY-MM-DD');
                const status = dateStatus[dateStr];
                return (
                  <div style={{ position: 'relative', height: '100%', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ lineHeight: '1.2' }}>{day}</span>
                    <div style={{ position: 'absolute', bottom: '4px', display: 'flex', gap: '6px', justifyContent: 'center', width: '100%' }}>
                      {status?.commodity && <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#60A5FA' }} title="已上传商品数据" />}
                      {status?.order && <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#F59E0B' }} title="已上传利润数据" />}
                    </div>
                  </div>
                );
              }}
            />
          </div>
          <div className="glass-panel" style={{ padding: '14px 18px', minWidth: '260px' }}>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '4px' }}>当前区间</div>
            <div style={{ fontSize: '16px', fontWeight: 600 }}>
              {startDate ? dayjs(startDate).format('YYYY-MM-DD') : '--'} 至 {endDate ? dayjs(endDate).format('YYYY-MM-DD') : '--'}
            </div>
            <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
              日期一变就会自动刷新商品范围，不需要再点确认。
            </div>
          </div>
        </div>

        <div className="compare-filter-grid">
          {renderSelectorCard({
            title: '过滤商品',
            tip: '商品列表会跟随日期动态刷新，勾选后只分析这些商品。',
            searchValue: productSearch,
            onSearchChange: setProductSearch,
            searchPlaceholder: '搜索商品名称或商品 ID',
            selectedCount: selectedProducts.length,
            totalCount: products.length,
            filteredCount: filteredProductOptions.length,
            allSelected: allFilteredProductsSelected,
            onToggleAll: handleToggleAllProducts,
            onClear: () => setSelectedProducts([]),
            clearDisabled: selectedProducts.length === 0,
            options: filteredProductOptions,
            selectedValues: selectedProducts,
            setter: setSelectedProducts,
            emptyText: '当前没有匹配的商品。',
          })}

          {renderSelectorCard({
            title: '关注维度',
            tip: '维度常驻展示在下方，支持模糊搜索、全选当前结果和即时勾选。',
            searchValue: metricSearch,
            onSearchChange: setMetricSearch,
            searchPlaceholder: '搜索维度名称',
            selectedCount: selectedMetrics.length,
            totalCount: METRIC_KEYS.length,
            filteredCount: filteredMetricOptions.length,
            allSelected: allFilteredMetricsSelected,
            onToggleAll: handleToggleAllMetrics,
            onClear: () => setSelectedMetrics([]),
            clearDisabled: selectedMetrics.length === 0,
            options: filteredMetricOptions,
            selectedValues: selectedMetrics,
            setter: setSelectedMetrics,
            emptyText: '当前没有匹配的维度。',
          })}
        </div>

        <div className="mobile-file-row" style={{ display: 'flex', gap: '16px', marginTop: '24px' }}>
          <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={handleSearch} disabled={loading || !startDate || !endDate || selectedProducts.length === 0 || selectedMetrics.length === 0}>
            {loading ? '正在生成分析视图...' : '生成分析视图'}
          </button>
          <button className="btn" style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--text-muted)', flex: '0 0 auto' }} onClick={handleReset}>
            重置筛选
          </button>
        </div>

        {(selectedProducts.length === 0 || selectedMetrics.length === 0) && (
          <div className="compare-helper-banner">至少选择 1 个商品和 1 个维度后，才能生成分析视图。</div>
        )}
      </div>

      {selectedMetrics.length === 1 && aggregatedRows.length > 0 && (
        <div className="glass-panel mb-32">
          <h3 style={{ marginBottom: '12px' }}>可视化分析</h3>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '20px' }}>
            当前只选中了一个维度，所以额外展示趋势图、Top10 日均柱状图和总计占比饼图，便于快速判断区间表现。
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '24px', marginBottom: '24px' }}>
            <div className="chart-container" style={{ height: '350px', background: 'rgba(255,255,255,0.4)', borderRadius: '12px', padding: '16px', border: '1px solid var(--glass-border)' }}>
              <ReactECharts option={getLineChartOption()} style={{ height: '100%' }} opts={{ renderer: 'svg' }} />
            </div>
          </div>

          <div className="mobile-chart-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px' }}>
            <div className="chart-container" style={{ height: '350px', background: 'rgba(255,255,255,0.4)', borderRadius: '12px', padding: '16px', border: '1px solid var(--glass-border)' }}>
              <ReactECharts option={getPieChartOption()} style={{ height: '100%' }} opts={{ renderer: 'svg' }} />
            </div>
            <div className="chart-container" style={{ height: '350px', background: 'rgba(255,255,255,0.4)', borderRadius: '12px', padding: '16px', border: '1px solid var(--glass-border)' }}>
              <ReactECharts option={getBarChartOption()} style={{ height: '100%' }} opts={{ renderer: 'svg' }} />
            </div>
          </div>
        </div>
      )}

      {hasGenerated && !loading && (
        aggregatedRows.length > 0 ? (
          <>
            <div className="glass-panel mb-32" style={{ paddingBottom: '18px' }}>
              <div className="mobile-table-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                  <h3 style={{ margin: 0, marginBottom: '6px' }}>多维聚合数据表</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    已按后端聚合口径生成 {aggregatedRows.length} 个商品结果，平均值按整个所选区间天数计算。
                  </p>
                </div>
                <button className="btn" style={{ padding: '6px 14px', fontSize: '13px', background: 'var(--success)', whiteSpace: 'nowrap' }} onClick={handleExportExcel}>
                  下载 Excel 数据表
                </button>
              </div>

              <div className="top-scrollbar-wrapper" ref={topScrollWrapperRef} onScroll={handleTopScroll}>
                <div style={{ width: tableScrollWidth, height: '1px' }} />
              </div>

              <div className="data-table-wrapper" ref={tableWrapperRef} onScroll={handleBottomScroll}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>商品名称</th>
                      <th>有数据天数/区间天数</th>
                      {selectedMetrics.map((metric) => (
                        <th key={metric} colSpan="4" style={{ textAlign: 'center' }}>
                          {ALL_METRICS[metric]}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      <th />
                      <th />
                      {selectedMetrics.map((metric) => (
                        <Fragment key={metric}>
                          {renderSortHeader('平均值', `${metric}_avg`)}
                          {renderSortHeader('总计', `${metric}_total`)}
                          {renderSortHeader('最大值', `${metric}_max`)}
                          {renderSortHeader('最小值', `${metric}_min`)}
                        </Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedData.map((row) => (
                      <tr key={row.product_id}>
                        <td title={row.product_name} style={{ maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.product_name}
                        </td>
                        <td>{row.days_count}/{selectedRangeDayCount}</td>
                        {selectedMetrics.map((metric) => (
                          <Fragment key={`${row.product_id}_${metric}`}>
                            <td style={{ color: 'var(--accent)' }}>{formatTableNumber(row[`${metric}_avg`])}</td>
                            <td style={{ fontWeight: 600 }}>{formatTableNumber(row[`${metric}_total`])}</td>
                            <td style={{ color: 'var(--success)' }}>{formatTableNumber(row[`${metric}_max`])}</td>
                            <td style={{ color: 'var(--danger)' }}>{formatTableNumber(row[`${metric}_min`])}</td>
                          </Fragment>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="compare-total-table">
                <div className="compare-total-table-title">筛选商品总体总计</div>
                <table className="data-table compare-summary-table">
                  <thead>
                    <tr>
                      <th>维度</th>
                      <th>总计</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedMetrics.map((metric) => (
                      <tr key={`total_${metric}`}>
                        <td>{ALL_METRICS[metric]}</td>
                        <td>{formatTableNumber(overallTotals[metric])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="compare-table-note">
                <div className="compare-table-note-title">口径说明</div>
                <div className="compare-table-note-item">平均值：所选区间内该商品该指标的总计 ÷ 区间总天数。</div>
                <div className="compare-table-note-item">总计：所选区间内该商品该指标的累计值。</div>
                <div className="compare-table-note-item">最大值 / 最小值：所选区间内该商品在已有数据日期中的单日最大值 / 最小值。</div>
              </div>
            </div>

            {comparisonSummary?.today && (
              <div className="mb-32">
                <div className="page-header" style={{ marginBottom: '20px' }}>
                  <div>
                    <h2 className="page-title" style={{ fontSize: '24px' }}>筛选商品核心指标</h2>
                    <p style={{ marginTop: '6px', color: 'var(--text-muted)', fontSize: '13px' }}>
                      这里的核心指标只受筛选商品和日期范围影响，不受上方维度勾选影响。
                    </p>
                  </div>
                </div>
                <SummaryMetricsGrid summary={comparisonSummary} prefix={getTitlePrefix()} />
              </div>
            )}
          </>
        ) : (
          <div className="glass-panel mb-32" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '10px' }}>当前筛选范围暂无可展示数据</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
              {errorMessage || '可以调整日期范围、商品勾选或维度后再重新生成分析视图。'}
            </div>
          </div>
        )
      )}
    </div>
  );
};

export default Compare;
