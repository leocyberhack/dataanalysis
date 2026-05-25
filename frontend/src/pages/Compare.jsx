import { Fragment, Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import { zhCN } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import {
  getCompareReport,
  getDateStatus,
  getDates,
  getPois,
  getProducts,
} from '../api';
import CompareSelectorCard from '../components/CompareSelectorCard';
import SummaryMetricsGrid from '../components/SummaryMetricsGrid';
import {
  ALL_METRICS,
  METRIC_KEYS,
  PERCENT_METRICS,
  formatMetricNumber as formatTableNumber,
} from '../constants/compareMetrics';
import {
  formatDateKey,
  formatDateRangeKeys,
  getTodayDate,
  parseStoredDate,
} from '../utils/date';
import { datePickerPopperProps } from '../utils/datePickerPopper';
import { createDateStatusDayRenderer } from '../utils/dateStatusDayRenderer';

registerLocale('zh-CN', zhCN);
const LazyCompareCharts = lazy(() => import('../components/CompareCharts'));

const VIRTUALIZATION_THRESHOLD = 120;
const VIRTUALIZATION_OVERSCAN = 12;
const TREND_SERIES_LIMIT = 5;

const getDefaultTableRowHeight = () => (window.innerWidth <= 768 ? 40 : 50);
const resolveVirtualScrollContainer = (tableWrapperElement) => {
  const scrollContainer = tableWrapperElement?.closest('.main-content');
  if (!scrollContainer) {
    return null;
  }

  const overflowY = window.getComputedStyle(scrollContainer).overflowY;
  const containerUsesOwnScroll = !['visible', 'clip'].includes(overflowY)
    && scrollContainer.scrollHeight > scrollContainer.clientHeight;

  return containerUsesOwnScroll ? scrollContainer : null;
};

const DEFAULT_METRICS = [];

const normalizeSearchText = (value) => value.toLowerCase().replace(/\s+/g, '');
const formatMetricValue = (metric, value) => (
  PERCENT_METRICS.has(metric) ? `${formatTableNumber(value)}%` : formatTableNumber(value)
);
const estimateNameWidth = (value) => Array.from(String(value || '')).reduce((total, character) => {
  const charCode = character.charCodeAt(0);
  const isWideCharacter = charCode > 255;
  return total + (isWideCharacter ? 14 : 8);
}, 0);
const clampColumnWidth = (width) => Math.min(Math.max(width, 220), 820);

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
  const nameColumnWidth = useMemo(() => {
    const longestNameWidth = sortedData.reduce(
      (maxWidth, row) => Math.max(maxWidth, estimateNameWidth(row.group_name)),
      estimateNameWidth(analysisMode === 'poi' ? 'POI' : '商品名称'),
    );
    return clampColumnWidth(longestNameWidth + 48);
  }, [analysisMode, sortedData]);
  const compareTableMinWidth = useMemo(
    () => Math.max(620, nameColumnWidth + selectedMetrics.length * 120),
    [nameColumnWidth, selectedMetrics.length],
  );

  const shouldVirtualizeTable = sortedData.length > VIRTUALIZATION_THRESHOLD;

  const totalMetricColumnCount = useMemo(
    () => 1 + selectedMetrics.length,
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

      const scrollContainer = resolveVirtualScrollContainer(tableWrapperRef.current);
      const wrapperRect = tableWrapperRef.current.getBoundingClientRect();
      const headHeight = tableHeadRef.current?.getBoundingClientRect().height || 0;
      let bodyTop = 0;
      let viewportTop = 0;
      let viewportBottom = 0;

      if (scrollContainer) {
        const containerRect = scrollContainer.getBoundingClientRect();
        const wrapperTop = wrapperRect.top - containerRect.top + scrollContainer.scrollTop;
        bodyTop = wrapperTop + headHeight;
        viewportTop = scrollContainer.scrollTop;
        viewportBottom = viewportTop + scrollContainer.clientHeight;
      } else {
        const wrapperTop = wrapperRect.top + window.scrollY;
        bodyTop = wrapperTop + headHeight;
        viewportTop = window.scrollY;
        viewportBottom = viewportTop + window.innerHeight;
      }

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

    const scrollContainer = resolveVirtualScrollContainer(tableWrapperRef.current);
    const scrollTarget = scrollContainer || window;

    updateVisibleRange();
    scrollTarget.addEventListener('scroll', updateVisibleRange, { passive: true });
    window.addEventListener('resize', updateVisibleRange);

    return () => {
      scrollTarget.removeEventListener('scroll', updateVisibleRange);
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
      const reportData = await getCompareReport(
        startStr,
        endStr,
        activeFilters,
        selectedMetrics,
        activeTrendMetric,
        TREND_SERIES_LIMIT,
      );
      const aggregateData = reportData.aggregate || {};
      const summaryData = reportData.summary || null;
      const nextAggregatedRows = aggregateData.rows || [];
      const trendResponse = reportData.trend || {};
      const trendData = activeTrendMetric ? (trendResponse.rows || []) : [];
      const nextTrendDates = activeTrendMetric ? (trendResponse.dates || []) : [];

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
    const headerRow = [analysisMode === 'poi' ? 'POI' : '商品名称'];

    selectedMetrics.forEach((metric) => {
      headerRow.push(ALL_METRICS[metric]);
    });
    sheetRows.push(headerRow);

    sortedData.forEach((row) => {
      const line = [row.group_name];
      selectedMetrics.forEach((metric) => {
        line.push(row[`${metric}_total`] || 0);
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
    sheetRows.push(['1. 表格仅展示总值：累计型指标为区间累计值；比率/值型指标为按整体口径重算后的区间值。']);
    sheetRows.push(['2. 占比指标为该行区间金额占全量金额的比例。']);

    const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
    worksheet['!cols'] = [
      { wch: 24 },
      ...selectedMetrics.map(() => ({ wch: 14 })),
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
              {...datePickerPopperProps}
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
                    已按后端聚合口径生成 {aggregatedRows.length} 个{analysisTargetLabel}结果。
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
                <table className="data-table compare-data-table" style={{ minWidth: `${compareTableMinWidth}px` }}>
                  <colgroup>
                    <col style={{ width: `${nameColumnWidth}px` }} />
                    {selectedMetrics.map((metric) => (
                      <col key={`${metric}-total-col`} />
                    ))}
                  </colgroup>
                  <thead ref={tableHeadRef}>
                    <tr>
                      <th>{analysisTargetLabel}</th>
                      {selectedMetrics.map((metric) => (
                        <Fragment key={metric}>
                          {renderSortHeader(ALL_METRICS[metric], `${metric}_total`)}
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
                        <td className="compare-name-cell" title={row.group_name}>
                          {row.group_name}
                        </td>
                        {selectedMetrics.map((metric) => (
                          <td key={`${row.group_key}_${metric}`} style={{ fontWeight: 600 }}>
                            {formatMetricValue(metric, row[`${metric}_total`])}
                          </td>
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
                        <td>{formatMetricValue(metric, overallTotals[metric])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="compare-table-note">
                <div className="compare-table-note-title">口径说明</div>
                <div className="compare-table-note-item">表格仅展示总值：累计型指标为区间累计值；比率/值型指标为按整体口径重算后的区间值。</div>
                <div className="compare-table-note-item">占比指标为该行区间金额占全量金额的比例。</div>
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

