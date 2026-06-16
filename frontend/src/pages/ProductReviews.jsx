import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { MessageSquare, Search, Star } from 'lucide-react';
import { getPois, getProductReviews, getProducts } from '../api';
import { echarts, getLargeLineSeriesOptions, getRendererForPointCount } from '../lib/echarts';

const normalizeSearchText = (value) => String(value || '').toLowerCase().replace(/\s+/g, '');

const formatRating = (value) => {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) {
    return '-';
  }
  return numericValue.toFixed(2).replace(/\.00$/, '');
};

const formatCount = (value) => Number(value || 0).toLocaleString();

const ProductReviews = () => {
  const [analysisMode, setAnalysisMode] = useState('product');
  const [products, setProducts] = useState([]);
  const [pois, setPois] = useState([]);
  const [searchText, setSearchText] = useState('');
  const deferredSearchText = useDeferredValue(searchText);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedPoiName, setSelectedPoiName] = useState('');
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [reviewPayload, setReviewPayload] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  const entityOptions = useMemo(() => {
    const source = analysisMode === 'poi' ? pois : products;
    return source.map((item) => ({ value: item.id, label: item.name }));
  }, [analysisMode, pois, products]);

  const selectedValue = analysisMode === 'poi' ? selectedPoiName : selectedProductId;
  const selectedOption = useMemo(
    () => entityOptions.find((option) => option.value === selectedValue),
    [entityOptions, selectedValue],
  );

  const filteredOptions = useMemo(() => {
    const keyword = normalizeSearchText(deferredSearchText);
    if (!keyword) {
      return entityOptions;
    }
    return entityOptions.filter((option) => normalizeSearchText(`${option.label}${option.value}`).includes(keyword));
  }, [deferredSearchText, entityOptions]);

  useEffect(() => {
    const loadOptions = async () => {
      setLoadingOptions(true);
      setErrorMessage('');
      try {
        const [nextProducts, nextPois] = await Promise.all([getProducts(), getPois()]);
        setProducts(nextProducts || []);
        setPois(nextPois || []);
      } catch (error) {
        console.error(error);
        setErrorMessage(error.response?.data?.detail || error.message || '评价筛选数据加载失败，请稍后重试。');
      } finally {
        setLoadingOptions(false);
      }
    };

    loadOptions();
  }, []);

  useEffect(() => {
    setSearchText('');
    setReviewPayload(null);
    setErrorMessage('');
  }, [analysisMode]);

  useEffect(() => {
    const targetValue = analysisMode === 'poi' ? selectedPoiName : selectedProductId;
    if (!targetValue) {
      setReviewPayload(null);
      return;
    }

    let ignore = false;
    const loadReviews = async () => {
      setLoadingReviews(true);
      setErrorMessage('');
      try {
        const payload = await getProductReviews({
          mode: analysisMode,
          productId: selectedProductId,
          poiName: selectedPoiName,
        });
        if (!ignore) {
          setReviewPayload(payload);
        }
      } catch (error) {
        console.error(error);
        if (!ignore) {
          setErrorMessage(error.response?.data?.detail || error.message || '评价数据加载失败，请稍后重试。');
          setReviewPayload(null);
        }
      } finally {
        if (!ignore) {
          setLoadingReviews(false);
        }
      }
    };

    loadReviews();
    return () => {
      ignore = true;
    };
  }, [analysisMode, selectedPoiName, selectedProductId]);

  const handleModeChange = (nextMode) => {
    setAnalysisMode(nextMode);
    setSelectedProductId('');
    setSelectedPoiName('');
  };

  const handleSelectEntity = (value) => {
    if (analysisMode === 'poi') {
      setSelectedPoiName(value);
    } else {
      setSelectedProductId(value);
    }
  };

  const handleClearSelection = () => {
    setSelectedProductId('');
    setSelectedPoiName('');
    setReviewPayload(null);
  };

  const trendRows = useMemo(() => reviewPayload?.trend || [], [reviewPayload]);
  const detailRows = reviewPayload?.rows || [];
  const summary = reviewPayload?.summary || {};

  const chartOption = useMemo(() => ({
    color: ['#e07a5f'],
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const point = params?.[0];
        if (!point) {
          return '';
        }
        const trendItem = trendRows[point.dataIndex] || {};
        return [
          `<strong>${point.axisValue}</strong>`,
          `平均评分：${formatRating(point.value)}`,
          `评价数：${formatCount(trendItem.review_count)}`,
        ].join('<br/>');
      },
    },
    grid: {
      top: 24,
      right: 24,
      bottom: 36,
      left: 44,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: trendRows.map((row) => row.date),
      axisLine: { lineStyle: { color: 'rgba(140, 123, 101, 0.35)' } },
      axisLabel: { color: '#8c7b65' },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 5,
      axisLabel: { color: '#8c7b65' },
      splitLine: { lineStyle: { color: 'rgba(224, 122, 95, 0.1)' } },
    },
    series: [
      {
        name: '平均评分',
        type: 'line',
        smooth: true,
        data: trendRows.map((row) => row.average_rating),
        lineStyle: { width: 3 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(224, 122, 95, 0.22)' },
              { offset: 1, color: 'rgba(224, 122, 95, 0.02)' },
            ],
          },
        },
        ...getLargeLineSeriesOptions(1, trendRows.length, 7),
      },
    ],
  }), [trendRows]);

  const scopeLabel = selectedOption?.label || reviewPayload?.scope_label || '';

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">评价分析</h1>
      </div>

      <div className="glass-panel mb-32">
        <div className="product-review-hero">
          <div>
            <div className="product-review-title-row">
              <MessageSquare size={22} />
              <h3>美团产品评价库</h3>
            </div>
            <p className="product-review-subtitle">
              单选一个商品或 POI，查看评价明细与评分随时间变化。POI 模式会合并该 POI 下所有商品评价。
            </p>
          </div>
          <div className="product-review-mode-switch">
            <button
              type="button"
              className={analysisMode === 'product' ? 'is-active' : ''}
              onClick={() => handleModeChange('product')}
            >
              商品
            </button>
            <button
              type="button"
              className={analysisMode === 'poi' ? 'is-active' : ''}
              onClick={() => handleModeChange('poi')}
            >
              POI
            </button>
          </div>
        </div>

        <div className="compare-selector-card product-review-selector">
          <div className="compare-selector-header">
            <div>
              <h3 style={{ marginBottom: '8px' }}>{analysisMode === 'poi' ? '选择 POI' : '选择商品'}</h3>
              <p className="compare-selector-tip">
                这里只能单选，选择后会自动刷新评价表和评分趋势。
              </p>
            </div>
            <div className="compare-selector-count">
              已选 {selectedValue ? 1 : 0} / 1
            </div>
          </div>

          <div className="compare-selector-toolbar">
            <div className="product-review-search-wrap">
              <Search size={16} />
              <input
                className="compare-selector-search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder={analysisMode === 'poi' ? '搜索 POI 名称' : '搜索商品名称或商品 ID'}
              />
            </div>
            <button
              type="button"
              className="compare-selector-action"
              onClick={handleClearSelection}
              disabled={!selectedValue}
            >
              清空
            </button>
          </div>

          <div className="compare-checkbox-list product-review-radio-list">
            {loadingOptions ? (
              <div className="compare-selector-empty">正在加载可选项...</div>
            ) : filteredOptions.length === 0 ? (
              <div className="compare-selector-empty">
                {analysisMode === 'poi' ? '当前没有匹配的 POI。' : '当前没有匹配的商品。'}
              </div>
            ) : (
              filteredOptions.map((option) => (
                <label
                  key={option.value}
                  className={`compare-checkbox-item ${selectedValue === option.value ? 'is-selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="product-review-target"
                    checked={selectedValue === option.value}
                    onChange={() => handleSelectEntity(option.value)}
                  />
                  <span className="compare-checkbox-label">{option.label}</span>
                </label>
              ))
            )}
          </div>
        </div>

        {errorMessage && <div className="compare-helper-banner">{errorMessage}</div>}
      </div>

      {selectedValue ? (
        <>
          <div className="product-review-summary-grid">
            <div className="glass-panel product-review-stat-card">
              <span>当前对象</span>
              <strong>{scopeLabel}</strong>
            </div>
            <div className="glass-panel product-review-stat-card">
              <span>评价数量</span>
              <strong>{loadingReviews ? '加载中...' : formatCount(summary.review_count)}</strong>
            </div>
            <div className="glass-panel product-review-stat-card">
              <span>平均评分</span>
              <strong>{loadingReviews ? '加载中...' : formatRating(summary.average_rating)}</strong>
            </div>
            <div className="glass-panel product-review-stat-card">
              <span>覆盖商品</span>
              <strong>{loadingReviews ? '加载中...' : formatCount(summary.product_count || (analysisMode === 'product' ? 1 : 0))}</strong>
            </div>
          </div>

          <div className="glass-panel mb-32">
            <div className="product-review-section-header">
              <div>
                <h3>评分时间趋势</h3>
                <p>按评价日期聚合平均评分，观察评分波动和评价密度。</p>
              </div>
            </div>
            {loadingReviews ? (
              <div className="product-review-empty">正在加载评分趋势...</div>
            ) : trendRows.length > 0 ? (
              <ReactEChartsCore
                echarts={echarts}
                option={chartOption}
                opts={{ renderer: getRendererForPointCount(1, trendRows.length) }}
                notMerge
                lazyUpdate
                style={{ height: '360px', width: '100%' }}
              />
            ) : (
              <div className="product-review-empty">暂无可展示的评分趋势。</div>
            )}
          </div>

          <div className="glass-panel">
            <div className="product-review-section-header">
              <div>
                <h3>评价明细表</h3>
                <p>
                  {loadingReviews ? '正在加载评价明细...' : `共 ${formatCount(detailRows.length)} 条评价。`}
                </p>
              </div>
            </div>

            {loadingReviews ? (
              <div className="product-review-empty">正在读取评价数据库...</div>
            ) : detailRows.length > 0 ? (
              <div className="data-table-wrapper product-review-table-wrapper">
                <table className="data-table product-review-table">
                  <thead>
                    <tr>
                      {analysisMode === 'poi' && <th>商品名称</th>}
                      <th>评价时间</th>
                      <th>评分</th>
                      <th>评价内容</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailRows.map((row) => (
                      <tr key={row.id}>
                        {analysisMode === 'poi' && (
                          <td className="product-review-name-cell" title={row.product_name}>
                            {row.product_name}
                          </td>
                        )}
                        <td>{row.review_time || '-'}</td>
                        <td>
                          <span className="product-review-rating">
                            <Star size={14} fill="currentColor" />
                            {formatRating(row.rating)}
                          </span>
                        </td>
                        <td className="product-review-content-cell">
                          {row.content || '（无文字评价）'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="product-review-empty">这个对象目前还没有导入评价。</div>
            )}
          </div>
        </>
      ) : (
        <div className="glass-panel product-review-empty">
          先从上方选择一个{analysisMode === 'poi' ? ' POI' : '商品'}，我就会把评价明细和评分趋势铺出来。
        </div>
      )}
    </div>
  );
};

export default ProductReviews;
