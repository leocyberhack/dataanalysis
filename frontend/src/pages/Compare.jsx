import { Fragment, Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import { zhCN } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import {
  getCompareAggregate,
  getCompareTrend,
  getDateStatus,
  getDates,
  getPois,
  getProducts,
  getSummary,
} from '../api';
import CompareSelectorCard from '../components/CompareSelectorCard';
import SummaryMetricsGrid from '../components/SummaryMetricsGrid';
import {
  formatDateKey,
  formatDateRangeKeys,
  getInclusiveDayCount,
  getTodayDate,
  parseStoredDate,
} from '../utils/date';
import { createDateStatusDayRenderer } from '../utils/dateStatusDayRenderer';

registerLocale('zh-CN', zhCN);
const LazyCompareCharts = lazy(() => import('../components/CompareCharts'));

const VIRTUALIZATION_THRESHOLD = 120;
const VIRTUALIZATION_OVERSCAN = 12;
const TREND_SERIES_LIMIT = 5;

const getDefaultTableRowHeight = () => (window.innerWidth <= 768 ? 40 : 50);
const getTopTrendGroupKeys = (rows, metric, limit = TREND_SERIES_LIMIT) => [...rows]
  .sort((left, right) => (right[`${metric}_total`] || 0) - (left[`${metric}_total`] || 0))
  .slice(0, limit)
  .map((row) => row.group_key);

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

const DEFAULT_METRICS = [];
const METRIC_KEYS = Object.keys(ALL_METRICS);

const normalizeSearchText = (value) => value.toLowerCase().replace(/\s+/g, '');
const formatTableNumber = (value) => Number(value || 0).toFixed(2);

const Compare = () => {
  const [dates, setDates] = useState([]);
  const [products, setProducts] = useState([]);
  const [pois, setPois] = useState([]);
  const [dateStatus, setDateStatus] = useState({});
  const [analysisMode, setAnalysisMode] = useState('product');

  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [pickerStartDate, setPickerStartDate] = useState(null);
  const [pickerEndDate, setPickerEndDate] = useState(null);

  const [selectedProducts, setSelectedProducts] = useState([]);
  const [selectedPois, setSelectedPois] = useState([]);
  const [selectedMetrics, setSelectedMetrics] = useState(DEFAULT_METRICS);
  const [entitySearch, setEntitySearch] = useState('');
  const [metricSearch, setMetricSearch] = useState('');

  const [rawData, setRawData] = useState([]);
  const [trendDates, setTrendDates] = useState([]);
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
  const tableHeadRef = useRef(null);
  const measuredRowRef = useRef(null);
  const [tableScrollWidth, setTableScrollWidth] = useState('100%');
  const [virtualRowHeight, setVirtualRowHeight] = useState(getDefaultTableRowHeight);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 0 });

  const selectedRangeDayCount = useMemo(
    () => getInclusiveDayCount(startDate, endDate),
    [endDate, startDate],
  );

  const entityOptions = useMemo(() => {
    const source = analysisMode === 'poi' ? pois : products;
    return source.map((item) => ({ value: item.id, label: item.name }));
  }, [analysisMode, pois, products]);

  const metricOptions = useMemo(
    () => METRIC_KEYS.map((metric) => ({ value: metric, label: ALL_METRICS[metric] })),
    [],
  );
  const selectedEntities = analysisMode === 'poi' ? selectedPois : selectedProducts;
  const setSelectedEntities = analysisMode === 'poi' ? setSelectedPois : setSelectedProducts;
  const selectedEntitySet = useMemo(() => new Set(selectedEntities), [selectedEntities]);
  const selectedMetricSet = useMemo(() => new Set(selectedMetrics), [selectedMetrics]);
  const renderDateStatusDay = useMemo(
    () => createDateStatusDayRenderer(dateStatus),
    [dateStatus],
  );

  const filteredEntityOptions = useMemo(() => {
    const keyword = normalizeSearchText(entitySearch);
    if (!keyword) {
      return entityOptions;
    }
    return entityOptions.filter((option) => normalizeSearchText(`${option.label}${option.value}`).includes(keyword));
  }, [entityOptions, entitySearch]);

  const filteredMetricOptions = useMemo(() => {
    const keyword = normalizeSearchText(metricSearch);
    if (!keyword) {
      return metricOptions;
    }
    return metricOptions.filter((option) => normalizeSearchText(`${option.label}${option.value}`).includes(keyword));
  }, [metricOptions, metricSearch]);
  const filteredEntityValues = useMemo(
    () => filteredEntityOptions.map((option) => option.value),
    [filteredEntityOptions],
  );
  const filteredMetricValues = useMemo(
    () => filteredMetricOptions.map((option) => option.value),
    [filteredMetricOptions],
  );

  const allFilteredEntitiesSelected = filteredEntityOptions.length > 0
    && filteredEntityOptions.every((option) => selectedEntitySet.has(option.value));
  const allFilteredMetricsSelected = filteredMetricOptions.length > 0
    && filteredMetricOptions.every((option) => selectedMetricSet.has(option.value));

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const [dbDates, status] = await Promise.all([getDates(), getDateStatus()]);
        setDates(dbDates);
        setDateStatus(status);

        const fallbackDate = dbDates.length > 0 ? parseStoredDate(dbDates[0]) : getTodayDate();
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

    const { startKey: startStr, endKey: endStr } = formatDateRangeKeys(startDate, endDate);

    Promise.all([getProducts(startStr, endStr), getPois(startStr, endStr)])
      .then(([nextProducts, nextPois]) => {
        const nextProductIds = new Set(nextProducts.map((product) => product.id));
        const nextPoiIds = new Set(nextPois.map((poi) => poi.id));
        setProducts(nextProducts);
        setPois(nextPois);
        setSelectedProducts((previousSelection) => previousSelection.filter((id) => nextProductIds.has(id)));
        setSelectedPois((previousSelection) => previousSelection.filter((id) => nextPoiIds.has(id)));
      })
      .catch(console.error);
  }, [endDate, startDate]);

  useEffect(() => {
    setHasGenerated(false);
    setErrorMessage('');
    setRawData([]);
    setTrendDates([]);
    setAggregatedRows([]);
    setOverallTotals({});
    setComparisonSummary(null);
  }, [analysisMode, endDate, selectedMetrics, selectedPois, selectedProducts, startDate]);

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

  const shouldVirtualizeTable = sortedData.length > VIRTUALIZATION_THRESHOLD;

  const totalMetricColumnCount = useMemo(
    () => 2 + selectedMetrics.length * 2,
    [selectedMetrics],
  );

  const effectiveVisibleRange = useMemo(() => {
    if (!shouldVirtualizeTable) {
      return { start: 0, end: sortedData.length };
    }

    const nextStart = Math.min(visibleRange.start, sortedData.length);
    const fallbackEnd = Math.min(sortedData.length, VIRTUALIZATION_THRESHOLD);
    const nextEnd = visibleRange.end === 0
      ? fallbackEnd
      : Math.min(sortedData.length, Math.max(visibleRange.end, nextStart));

    return { start: nextStart, end: nextEnd };
  }, [shouldVirtualizeTable, sortedData.length, visibleRange.end, visibleRange.start]);

  const visibleRows = useMemo(() => {
    if (!shouldVirtualizeTable) {
      return sortedData;
    }
    return sortedData.slice(effectiveVisibleRange.start, effectiveVisibleRange.end);
  }, [effectiveVisibleRange.end, effectiveVisibleRange.start, shouldVirtualizeTable, sortedData]);

  const topSpacerHeight = shouldVirtualizeTable ? effectiveVisibleRange.start * virtualRowHeight : 0;
  const bottomSpacerHeight = shouldVirtualizeTable
    ? Math.max(0, (sortedData.length - effectiveVisibleRange.end) * virtualRowHeight)
    : 0;

  useEffect(() => {
    if (!shouldVirtualizeTable) {
      setVisibleRange({ start: 0, end: sortedData.length });
      return;
    }

    const updateVisibleRange = () => {
      if (!tableWrapperRef.current) {
        return;
      }

      const wrapperRect = tableWrapperRef.current.getBoundingClientRect();
      const wrapperTop = wrapperRect.top + window.scrollY;
      const headHeight = tableHeadRef.current?.getBoundingClientRect().height || 0;
      const bodyTop = wrapperTop + headHeight;
      const viewportTop = window.scrollY;
      const viewportBottom = viewportTop + window.innerHeight;
      const relativeViewportTop = Math.max(0, viewportTop - bodyTop);
      const relativeViewportBottom = Math.max(0, viewportBottom - bodyTop);
      const nextStart = Math.min(
        sortedData.length,
        Math.max(0, Math.floor(relativeViewportTop / virtualRowHeight) - VIRTUALIZATION_OVERSCAN),
      );
      const nextEnd = Math.min(
        sortedData.length,
        Math.max(
          nextStart,
          Math.ceil(relativeViewportBottom / virtualRowHeight) + VIRTUALIZATION_OVERSCAN,
        ),
      );

      setVisibleRange((previous) => (
        previous.start === nextStart && previous.end === nextEnd
          ? previous
          : { start: nextStart, end: nextEnd }
      ));
    };

    updateVisibleRange();
    window.addEventListener('scroll', updateVisibleRange, { passive: true });
    window.addEventListener('resize', updateVisibleRange);

    return () => {
      window.removeEventListener('scroll', updateVisibleRange);
      window.removeEventListener('resize', updateVisibleRange);
    };
  }, [shouldVirtualizeTable, sortedData.length, virtualRowHeight]);

  useEffect(() => {
    if (!shouldVirtualizeTable || !measuredRowRef.current) {
      return;
    }

    const nextMeasuredHeight = measuredRowRef.current.getBoundingClientRect().height;
    if (nextMeasuredHeight > 0 && Math.abs(nextMeasuredHeight - virtualRowHeight) > 1) {
      setVirtualRowHeight(nextMeasuredHeight);
    }
  }, [shouldVirtualizeTable, virtualRowHeight, visibleRows]);

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

  const handleSearch = async () => {
    if (!startDate || !endDate || selectedEntities.length === 0 || selectedMetrics.length === 0) {
      return;
    }

    const { startKey: startStr, endKey: endStr } = formatDateRangeKeys(startDate, endDate);
    const activeTrendMetric = selectedMetrics.length === 1 ? selectedMetrics[0] : '';
    const activeFilters = {
      mode: analysisMode,
      values: selectedEntities,
    };

    setLoading(true);
    setHasGenerated(true);
    setErrorMessage('');

    try {
      const [aggregateData, summaryData] = await Promise.all([
        getCompareAggregate(startStr, endStr, activeFilters, selectedMetrics),
        getSummary(startStr, endStr, activeFilters),
      ]);
      const nextAggregatedRows = aggregateData.rows || [];
      let trendData = [];
      let nextTrendDates = [];

      if (activeTrendMetric) {
        const topTrendGroupKeys = getTopTrendGroupKeys(nextAggregatedRows, activeTrendMetric);
        if (topTrendGroupKeys.length > 0) {
          try {
            const trendResponse = await getCompareTrend(
              startStr,
              endStr,
              activeTrendMetric,
              {
                mode: analysisMode,
                values: topTrendGroupKeys,
              },
            );
            trendData = trendResponse.rows || [];
            nextTrendDates = trendResponse.dates || [];
          } catch (trendError) {
            console.error(trendError);
          }
        }
      }

      setRawData(trendData);
      setTrendDates(nextTrendDates);
      setAggregatedRows(nextAggregatedRows);
      setOverallTotals(aggregateData.overall_totals || {});
      setComparisonSummary(summaryData);
    } catch (error) {
      console.error(error);
      setRawData([]);
      setTrendDates([]);
      setAggregatedRows([]);
      setOverallTotals({});
      setComparisonSummary(null);
      setErrorMessage(error.response?.data?.detail || error.message || '生成分析失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    const latest = dates.length > 0 ? parseStoredDate(dates[0]) : getTodayDate();
    setStartDate(latest);
    setEndDate(latest);
    setPickerStartDate(latest);
    setPickerEndDate(latest);
    setAnalysisMode('product');
    setSelectedProducts([]);
    setSelectedPois([]);
    setSelectedMetrics(DEFAULT_METRICS);
    setEntitySearch('');
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
    const headerRow = [analysisMode === 'poi' ? 'POI' : '商品名称', '有数据天数/区间天数'];

    selectedMetrics.forEach((metric) => {
      headerRow.push(
        `${ALL_METRICS[metric]} - 平均值`,
        `${ALL_METRICS[metric]} - 总计`,
      );
    });
    sheetRows.push(headerRow);

    sortedData.forEach((row) => {
      const line = [row.group_name, `${row.days_count}/${selectedRangeDayCount}`];
      selectedMetrics.forEach((metric) => {
        line.push(
          row[`${metric}_avg`] || 0,
          row[`${metric}_total`] || 0,
        );
      });
      sheetRows.push(line);
    });

    sheetRows.push([]);
    sheetRows.push([`筛选${analysisTargetLabel}总体汇总`]);
    sheetRows.push(['维度', '总体值']);
    selectedMetrics.forEach((metric) => {
      sheetRows.push([ALL_METRICS[metric], overallTotals[metric] || 0]);
    });

    sheetRows.push([]);
    sheetRows.push(['备注']);
    sheetRows.push(['1. 平均值：累计型指标按区间总值除以区间总天数；比率/值型指标按区间内每日指标值做日均处理。']);
    sheetRows.push(['2. 总计：对累计型指标展示区间累计值；对比率/值型指标展示按整体口径重算后的区间值。']);

    const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
    worksheet['!cols'] = [
      { wch: 24 },
      { wch: 18 },
      ...selectedMetrics.flatMap(() => [{ wch: 14 }, { wch: 14 }]),
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '多维分析');
    const { startKey, endKey } = formatDateRangeKeys(startDate, endDate);
    XLSX.writeFile(
      workbook,
      `多维分析_${startKey}_至_${endKey}.xlsx`,
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

  const getTitlePrefix = () => {
    if (!startDate || !endDate) {
      return '当日';
    }
    const { startKey: startStr, endKey: endStr } = formatDateRangeKeys(startDate, endDate);
    return startStr === endStr ? '当日' : '该周期';
  };

  const analysisTargetLabel = analysisMode === 'poi' ? 'POI' : '商品';

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">多维分析与对比</h1>
      </div>

      <div className="glass-panel mb-32">
        <div className="mobile-date-row" style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '24px' }}>
          <div className="input-group status-datepicker-wrapper is-compare mobile-full-width" style={{ flex: '1 1 320px' }}>
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
              renderDayContents={renderDateStatusDay}
            />
          </div>
          <div className="glass-panel" style={{ padding: '14px 18px', minWidth: '260px' }}>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '4px' }}>当前区间</div>
            <div style={{ fontSize: '16px', fontWeight: 600 }}>
              {startDate ? formatDateKey(startDate) : '--'} 至 {endDate ? formatDateKey(endDate) : '--'}
            </div>
            <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
              日期一变就会自动刷新可选范围，不需要再点确认。
            </div>
          </div>
          <div className="glass-panel" style={{ padding: '14px 18px', minWidth: '260px' }}>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '4px' }}>聚合模式</div>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', cursor: 'pointer' }}>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 600 }}>{analysisMode === 'poi' ? '按 POI 聚合' : '按商品聚合'}</div>
                <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  关闭是商品模式，开启后改为 POI 模式。
                </div>
              </div>
              <input
                type="checkbox"
                checked={analysisMode === 'poi'}
                onChange={(event) => setAnalysisMode(event.target.checked ? 'poi' : 'product')}
                style={{ width: '18px', height: '18px', accentColor: 'var(--accent)' }}
              />
            </label>
          </div>
        </div>

        <div className="compare-filter-grid">
          <CompareSelectorCard
            title={analysisMode === 'poi' ? '过滤 POI' : '过滤商品'}
            tip={analysisMode === 'poi'
              ? 'POI 列表会跟随日期动态刷新，勾选后会按 POI 聚合分析。'
              : '商品列表会跟随日期动态刷新，勾选后只分析这些商品。'}
            searchValue={entitySearch}
            onSearchChange={setEntitySearch}
            searchPlaceholder={analysisMode === 'poi' ? '搜索 POI 名称' : '搜索商品名称或商品 ID'}
            selectedCount={selectedEntities.length}
            totalCount={entityOptions.length}
            filteredCount={filteredEntityOptions.length}
            allSelected={allFilteredEntitiesSelected}
            filteredValues={filteredEntityValues}
            options={filteredEntityOptions}
            selectedValueSet={selectedEntitySet}
            setSelectedValues={setSelectedEntities}
            toggleAllText={allFilteredEntitiesSelected ? '取消全选当前结果' : '全选当前结果'}
            clearText="清空"
            masterCheckText={`全选符合搜索条件的选项（${filteredEntityOptions.length}）`}
            clearDisabled={selectedEntities.length === 0}
            emptyText={analysisMode === 'poi' ? '当前没有匹配的 POI。' : '当前没有匹配的商品。'}
          />

          <CompareSelectorCard
            title="关注维度"
            tip="维度常驻展示在下方，支持模糊搜索、全选当前结果和即时勾选。"
            searchValue={metricSearch}
            onSearchChange={setMetricSearch}
            searchPlaceholder="搜索维度名称"
            selectedCount={selectedMetrics.length}
            totalCount={METRIC_KEYS.length}
            filteredCount={filteredMetricOptions.length}
            allSelected={allFilteredMetricsSelected}
            filteredValues={filteredMetricValues}
            options={filteredMetricOptions}
            selectedValueSet={selectedMetricSet}
            setSelectedValues={setSelectedMetrics}
            toggleAllText={allFilteredMetricsSelected ? '取消全选当前结果' : '全选当前结果'}
            clearText="清空"
            masterCheckText={`全选符合搜索条件的选项（${filteredMetricOptions.length}）`}
            clearDisabled={selectedMetrics.length === 0}
            emptyText="当前没有匹配的维度。"
          />
        </div>
        <div className="mobile-file-row" style={{ display: 'flex', gap: '16px', marginTop: '24px' }}>
          <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={handleSearch} disabled={loading || !startDate || !endDate || selectedEntities.length === 0 || selectedMetrics.length === 0}>
            {loading ? '正在生成分析视图...' : '生成分析视图'}
          </button>
          <button className="btn" style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--text-muted)', flex: '0 0 auto' }} onClick={handleReset}>
            重置筛选
          </button>
        </div>

        {(selectedEntities.length === 0 || selectedMetrics.length === 0) && (
          <div className="compare-helper-banner">至少选择 1 个{analysisTargetLabel}和 1 个维度后，才能生成分析视图。</div>
        )}
      </div>

      {selectedMetrics.length === 1 && aggregatedRows.length > 0 && (
        <div className="glass-panel mb-32">
          <h3 style={{ marginBottom: '12px' }}>可视化分析</h3>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '20px' }}>
            当前只选中了一个维度，所以额外展示趋势图、Top10 日均柱状图和总计占比饼图，便于快速判断区间表现。
          </p>

          <Suspense fallback={<div className="compare-chart-panel">Loading charts...</div>}>
            <LazyCompareCharts
              aggregatedRows={aggregatedRows}
              rawData={rawData}
              trendDates={trendDates}
              selectedMetrics={selectedMetrics}
              metricLabels={ALL_METRICS}
            />
          </Suspense>
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
                    已按后端聚合口径生成 {aggregatedRows.length} 个{analysisTargetLabel}结果，平均值按整个所选区间天数计算。
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
                  <thead ref={tableHeadRef}>
                    <tr>
                      <th>{analysisTargetLabel}</th>
                      <th>有数据天数/区间天数</th>
                      {selectedMetrics.map((metric) => (
                        <th key={metric} colSpan="2" style={{ textAlign: 'center' }}>
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
                        </Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {topSpacerHeight > 0 && (
                      <tr className="virtual-spacer-row" aria-hidden="true">
                        <td colSpan={totalMetricColumnCount} style={{ height: `${topSpacerHeight}px`, padding: 0, border: 0 }} />
                      </tr>
                    )}
                    {visibleRows.map((row, rowIndex) => (
                      <tr
                        key={row.group_key}
                        ref={rowIndex === 0 ? measuredRowRef : null}
                        style={shouldVirtualizeTable ? { height: `${virtualRowHeight}px` } : undefined}
                      >
                        <td title={row.group_name} style={{ maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.group_name}
                        </td>
                        <td>{row.days_count}/{selectedRangeDayCount}</td>
                        {selectedMetrics.map((metric) => (
                          <Fragment key={`${row.group_key}_${metric}`}>
                            <td style={{ color: 'var(--accent)' }}>{formatTableNumber(row[`${metric}_avg`])}</td>
                            <td style={{ fontWeight: 600 }}>{formatTableNumber(row[`${metric}_total`])}</td>
                          </Fragment>
                        ))}
                      </tr>
                    ))}
                    {bottomSpacerHeight > 0 && (
                      <tr className="virtual-spacer-row" aria-hidden="true">
                        <td colSpan={totalMetricColumnCount} style={{ height: `${bottomSpacerHeight}px`, padding: 0, border: 0 }} />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="compare-total-table">
                <div className="compare-total-table-title">筛选{analysisTargetLabel}总体汇总</div>
                <table className="data-table compare-summary-table">
                  <thead>
                    <tr>
                      <th>维度</th>
                      <th>总体值</th>
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
                <div className="compare-table-note-item">平均值：累计型指标按区间总值除以区间总天数；比率/值型指标按区间内每日指标值做日均处理。</div>
                <div className="compare-table-note-item">总计：对累计型指标展示区间累计值；对比率/值型指标展示按整体口径重算后的区间值。</div>
              </div>
            </div>

            {comparisonSummary?.today && (
              <div className="mb-32">
                <div className="page-header" style={{ marginBottom: '20px' }}>
                  <div>
                    <h2 className="page-title" style={{ fontSize: '24px' }}>筛选{analysisTargetLabel}核心指标</h2>
                    <p style={{ marginTop: '6px', color: 'var(--text-muted)', fontSize: '13px' }}>
                      这里的核心指标只受筛选{analysisTargetLabel}和日期范围影响，不受上方维度勾选影响。
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

