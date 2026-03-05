import React, { useState, useEffect, useMemo, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';
import Select from 'react-select';
import * as XLSX from 'xlsx';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { getDates, getProducts, getDetailedData } from '../api';

let compareCache = {
    inited: false,
    startDate: '',
    endDate: '',
    selectedProducts: [],
    selectedMetrics: ['pay_amount'],
    sortMetric: '',
    sortOrder: 'desc',
    rawData: []
};

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
    refund_rate_item: '成功退款率(件)',
    redeem_items: '核销件数',
    redeem_amount: '核销金额',
    redeem_rate_item: '核销率(件)',
    live_pay_orders: '店播支付订单量',
    live_pay_users: '店播支付用户数',
    live_pay_coupons: '店播支付券量',
    live_consume_amount: '店播消费金额',
    live_consume_coupons: '店播消费券量',
    live_consume_orders: '店播消费订单量',
    live_refund_amount: '店播退款金额',
    live_consume_rate: '店播消费率',
    live_refund_rate: '店播退款率'
};

const Compare = () => {
    const [dates, setDates] = useState([]);
    const [products, setProducts] = useState([]);

    const [startDate, setStartDate] = useState(compareCache.inited && compareCache.startDate ? dayjs(compareCache.startDate).toDate() : dayjs().toDate());
    const [endDate, setEndDate] = useState(compareCache.inited && compareCache.endDate ? dayjs(compareCache.endDate).toDate() : dayjs().toDate());
    const [dateRange, setDateRange] = useState([startDate, endDate]);

    const [selectedProducts, setSelectedProducts] = useState(compareCache.selectedProducts);
    const [selectedMetrics, setSelectedMetrics] = useState(compareCache.selectedMetrics);
    const [sortMetric, setSortMetric] = useState(compareCache.sortMetric);
    const [sortOrder, setSortOrder] = useState(compareCache.sortOrder);

    const [rawData, setRawData] = useState(compareCache.rawData);
    const [loading, setLoading] = useState(false);

    const tableWrapperRef = useRef(null);
    const topScrollWrapperRef = useRef(null);
    const [tableScrollWidth, setTableScrollWidth] = useState('100%');

    useEffect(() => {
        compareCache = {
            inited: true,
            startDate: dayjs(startDate).format('YYYY-MM-DD'),
            endDate: dayjs(endDate).format('YYYY-MM-DD'),
            selectedProducts,
            selectedMetrics,
            sortMetric,
            sortOrder,
            rawData
        };
    }, [startDate, endDate, selectedProducts, selectedMetrics, sortMetric, sortOrder, rawData]);

    useEffect(() => {
        let timer;
        const updateWidth = () => {
            if (tableWrapperRef.current) {
                // Read the actual scrollable width of the table
                setTableScrollWidth(`${tableWrapperRef.current.scrollWidth}px`);
            }
        };
        // Delay slightly to ensure table has painted
        timer = setTimeout(updateWidth, 100);
        window.addEventListener('resize', updateWidth);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('resize', updateWidth);
        };
    }, [rawData, selectedMetrics]); // Update when data or columns change

    const handleTopScroll = (e) => {
        if (tableWrapperRef.current && tableWrapperRef.current.scrollLeft !== e.target.scrollLeft) {
            tableWrapperRef.current.scrollLeft = e.target.scrollLeft;
        }
    };

    const handleBottomScroll = (e) => {
        if (topScrollWrapperRef.current && topScrollWrapperRef.current.scrollLeft !== e.target.scrollLeft) {
            topScrollWrapperRef.current.scrollLeft = e.target.scrollLeft;
        }
    };

    useEffect(() => {
        Promise.all([getDates(), getProducts()]).then(([d, p]) => {
            setDates(d);
            setProducts(p);
        }).catch(e => console.error(e));
    }, []);

    const handleSearch = async () => {
        if (!startDate || !endDate) return;
        setLoading(true);
        try {
            const startStr = dayjs(startDate).format('YYYY-MM-DD');
            const endStr = dayjs(endDate).format('YYYY-MM-DD');
            const data = await getDetailedData(startStr, endStr, selectedProducts);
            setRawData(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleReset = () => {
        const today = dayjs().toDate();
        setDateRange([today, today]);
        setStartDate(today);
        setEndDate(today);
        setSelectedProducts([]);
        setSelectedMetrics(['pay_amount']);
        setSortMetric('');
        setSortOrder('desc');
        setRawData([]);
    };

    const handleExportExcel = () => {
        if (!tableWrapperRef.current) return;
        const table = tableWrapperRef.current.querySelector('table');
        if (!table) return;

        const tableClone = table.cloneNode(true);
        const ths = tableClone.querySelectorAll('th');
        ths.forEach(th => {
            const spans = th.querySelectorAll('span');
            if (spans.length > 1) {
                spans[1].remove();
            }
            th.innerText = th.innerText.replace(/[\u2191\u2193\u2195]/g, '').trim();
        });

        const wb = XLSX.utils.table_to_book(tableClone, { raw: true });
        XLSX.writeFile(wb, `数据导出_${dayjs(startDate).format('YYYY-MM-DD')}_至_${dayjs(endDate).format('YYYY-MM-DD')}.xlsx`);
    };

    const handleDateRangeChange = (update) => {
        setDateRange(update);
        const [start, end] = update;
        if (start) setStartDate(start);
        if (end) setEndDate(end);
    };

    const handleProductsChange = (selectedOptions) => {
        setSelectedProducts(selectedOptions ? selectedOptions.map(o => o.value) : []);
    };

    const handleMetricsChange = (selectedOptions) => {
        setSelectedMetrics(selectedOptions ? selectedOptions.map(o => o.value) : []);
    };

    // 聚合数据：根据所选商品，计算在选定日期范围内的合计/平均/最大/最小
    const aggregatedData = useMemo(() => {
        if (!rawData.length) return [];

        // 分组
        const grouped = {};
        rawData.forEach(row => {
            const pid = row.product_id;
            if (!grouped[pid]) {
                grouped[pid] = {
                    product_id: pid,
                    product_name: row.product_name,
                    count: 0
                };
                Object.keys(ALL_METRICS).forEach(m => {
                    grouped[pid][m + '_sum'] = 0;
                    grouped[pid][m + '_max'] = -Infinity;
                    grouped[pid][m + '_min'] = Infinity;
                    grouped[pid][m + '_values'] = []; // 用于计算中位数
                });
            }
            grouped[pid].count += 1;

            Object.keys(ALL_METRICS).forEach(m => {
                const val = row[m] !== null && row[m] !== undefined ? parseFloat(row[m]) : 0;
                grouped[pid][m + '_sum'] += val;
                grouped[pid][m + '_max'] = Math.max(grouped[pid][m + '_max'], val);
                grouped[pid][m + '_min'] = Math.min(grouped[pid][m + '_min'], val);
                grouped[pid][m + '_values'].push(val);
            });
        });

        return Object.values(grouped).map(item => {
            const result = {
                product_id: item.product_id,
                product_name: item.product_name,
                days_count: item.count
            };

            Object.keys(ALL_METRICS).forEach(m => {
                // 计算平均值
                result[m + '_avg'] = item[m + '_sum'] / item.count;
                result[m + '_total'] = item[m + '_sum'];
                result[m + '_max'] = item[m + '_max'] === -Infinity ? 0 : item[m + '_max'];
                result[m + '_min'] = item[m + '_min'] === Infinity ? 0 : item[m + '_min'];

                // 计算中位数
                const sorted = item[m + '_values'].sort((a, b) => a - b);
                const mid = Math.floor(sorted.length / 2);
                result[m + '_median'] = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
            });

            return result;
        });
    }, [rawData]);

    const sortedData = useMemo(() => {
        let tableData = [...aggregatedData];
        if (sortMetric) {
            tableData.sort((a, b) => {
                const valA = a[sortMetric] || 0;
                const valB = b[sortMetric] || 0;
                return sortOrder === 'desc' ? valB - valA : valA - valB;
            });
        }
        return tableData;
    }, [aggregatedData, sortMetric, sortOrder]);

    const handleSort = (metricKey) => {
        if (sortMetric === metricKey) {
            if (sortOrder === 'desc') {
                setSortOrder('asc');
            } else {
                setSortMetric('');
                setSortOrder('desc');
            }
        } else {
            setSortMetric(metricKey);
            setSortOrder('desc');
        }
    };

    const getLineChartOption = () => {
        if (!rawData.length || selectedMetrics.length !== 1) return {};
        const activeMetric = selectedMetrics[0];

        const xAxisDates = Array.from(new Set(rawData.map(d => d.date))).sort();
        const series = [];
        const legend = [];

        // For trend line, we render ONLY the first selected metric for up to 5 properties
        // otherwise mixing different units (e.g. 5000 CNY and 20%) in one axis causes unreadable scaling
        const displayProducts = [...new Set(rawData.map(d => d.product_id))].slice(0, 5);

        displayProducts.forEach(pid => {
            const pName = products.find(p => p.id === pid)?.name || pid;
            const dataPoints = xAxisDates.map(date => {
                const row = rawData.find(r => r.date === date && r.product_id === pid);
                return row ? parseFloat(row[activeMetric] || 0) : 0;
            });

            const shortName = pName.length > 8 ? pName.substring(0, 8) + '...' : pName;
            legend.push(shortName);
            series.push({
                name: shortName,
                type: 'line',
                smooth: true,
                symbolSize: 8,
                data: dataPoints,
                emphasis: { focus: 'series' }
            });
        });

        return {
            title: { text: `趋势: ${ALL_METRICS[activeMetric]}`, textStyle: { fontSize: 14, color: 'var(--text-main)', fontWeight: 'normal' } },
            tooltip: { trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.9)', borderColor: 'var(--glass-border)' },
            legend: { data: legend, textStyle: { color: 'var(--text-muted)' }, type: 'scroll', top: 0, right: 0, width: '60%' },
            grid: { left: '3%', right: '4%', bottom: '5%', top: '40px', containLabel: true },
            xAxis: { type: 'category', boundaryGap: false, data: xAxisDates, axisLabel: { color: 'var(--text-muted)' } },
            yAxis: { type: 'value', axisLabel: { color: 'var(--text-muted)' }, splitLine: { lineStyle: { color: 'var(--glass-border)' } } },
            series: series
        };
    };

    const getBarChartOption = () => {
        if (!aggregatedData.length || selectedMetrics.length !== 1) return {};
        const activeMetric = selectedMetrics[0];

        // Get Top 10 by average value for this metric
        const top10 = [...aggregatedData]
            .sort((a, b) => b[activeMetric + '_avg'] - a[activeMetric + '_avg'])
            .slice(0, 10);

        return {
            title: { text: `TOP 10 : ${ALL_METRICS[activeMetric]} (平均值)`, textStyle: { fontSize: 14, color: 'var(--text-main)', fontWeight: 'normal' } },
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: 'rgba(255,255,255,0.9)' },
            grid: { left: '3%', right: '4%', bottom: '5%', top: '40px', containLabel: true },
            xAxis: { type: 'value', axisLabel: { color: 'var(--text-muted)' }, splitLine: { lineStyle: { color: 'var(--glass-border)' } } },
            yAxis: {
                type: 'category',
                data: top10.map(item => item.product_name.length > 6 ? item.product_name.substring(0, 6) + '...' : item.product_name).reverse(),
                axisLabel: { color: 'var(--text-muted)' }
            },
            series: [
                {
                    name: ALL_METRICS[activeMetric],
                    type: 'bar',
                    data: top10.map(item => item[activeMetric + '_avg']).reverse(),
                    itemStyle: { borderRadius: [0, 4, 4, 0], color: 'var(--accent)' }
                }
            ]
        };
    };

    const getPieChartOption = () => {
        if (!aggregatedData.length || selectedMetrics.length !== 1) return {};
        const activeMetric = selectedMetrics[0];

        const top10 = [...aggregatedData]
            .sort((a, b) => b[activeMetric + '_total'] - a[activeMetric + '_total'])
            .slice(0, 10);

        const pieData = top10.map(item => ({
            value: item[activeMetric + '_total'],
            name: item.product_name.length > 10 ? item.product_name.substring(0, 10) + '...' : item.product_name
        }));

        return {
            title: {
                text: `${ALL_METRICS[activeMetric]} 总量占比 (Top10)`,
                left: 'center',
                textStyle: { fontSize: 14, color: 'var(--text-main)', fontWeight: 'normal' }
            },
            tooltip: { trigger: 'item', backgroundColor: 'rgba(255,255,255,0.9)' },
            legend: { show: false },
            series: [
                {
                    name: ALL_METRICS[activeMetric],
                    type: 'pie',
                    radius: ['40%', '70%'],
                    avoidLabelOverlap: true,
                    itemStyle: {
                        borderRadius: 10,
                        borderColor: 'rgba(255,255,255,0.8)',
                        borderWidth: 2
                    },
                    label: { show: true, color: 'var(--text-muted)', formatter: '{b}\n{d}%' },
                    data: pieData
                }
            ]
        };
    };

    const renderSortHeader = (label, mKey, isFirst = false) => {
        const isActive = sortMetric === mKey;
        const arrow = isActive ? (sortOrder === 'desc' ? '↓' : '↑') : '↕';
        const color = isActive ? 'var(--accent)' : 'var(--text-muted)';

        return (
            <th
                style={{
                    cursor: 'pointer',
                    userSelect: 'none',
                    transition: 'color 0.2s',
                    whiteSpace: 'nowrap'
                }}
                onClick={() => handleSort(mKey)}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-start' }}>
                    <span style={{ color: isActive ? 'var(--text-main)' : 'inherit' }}>{label}</span>
                    <span style={{ fontSize: '12px', color, opacity: isActive ? 1 : 0.4 }}>{arrow}</span>
                </div>
            </th>
        );
    };

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">多维分析与比较</h1>
            </div>

            <div className="glass-panel mb-32">
                <style>
                    {`
                    .react-datepicker-wrapper {
                        width: 100%;
                    }
                    .react-datepicker__input-container input {
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
                    .react-datepicker__input-container input:hover {
                        border-color: rgba(224, 122, 95, 0.4);
                        background: rgba(255, 255, 255, 0.9);
                    }
                    .react-datepicker__input-container input:focus {
                        border-color: var(--accent);
                        box-shadow: 0 0 0 3px rgba(224, 122, 95, 0.15);
                        background: #ffffff;
                    }
                    `}
                </style>
                <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div className="input-group" style={{ flex: '1 1 300px' }}>
                        <label className="input-label" style={{ marginBottom: '8px' }}>目标日期范围</label>
                        <DatePicker
                            selectsRange={true}
                            startDate={dateRange[0]}
                            endDate={dateRange[1]}
                            onChange={handleDateRangeChange}
                            dateFormat="yyyy-MM-dd"
                            isClearable={false}
                            placeholderText="请选择开始和结束日期..."
                            showPopperArrow={false}
                            className="input"
                            style={{ width: '100%' }}
                        />
                    </div>
                </div>

                <div className="input-group" style={{ marginTop: '20px' }}>
                    <label className="input-label" style={{ marginBottom: '8px' }}>过滤商品 (默认全部)</label>
                    <Select
                        isMulti
                        closeMenuOnSelect={false}
                        options={products.map(p => ({ value: p.id, label: p.name }))}
                        value={products.filter(p => selectedProducts.includes(p.id)).map(p => ({ value: p.id, label: p.name }))}
                        onChange={handleProductsChange}
                        placeholder="搜索并选择要查看的商品..."
                        noOptionsMessage={() => "未找到该商品"}
                        styles={{
                            control: (base) => ({
                                ...base,
                                background: 'rgba(255, 255, 255, 0.8)',
                                borderColor: 'rgba(224, 122, 95, 0.2)',
                                borderRadius: '8px',
                                boxShadow: 'none',
                                '&:hover': { borderColor: 'var(--accent)' }
                            }),
                            valueContainer: (base) => ({
                                ...base,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'stretch',
                                padding: '8px',
                                gap: '4px'
                            }),
                            multiValue: (base) => ({
                                ...base,
                                display: 'flex',
                                justifyContent: 'space-between',
                                background: 'var(--accent-light)',
                                borderRadius: '6px',
                                padding: '4px 8px',
                                margin: 0
                            }),
                            multiValueLabel: (base) => ({
                                ...base,
                                color: 'var(--accent)',
                                fontWeight: 500,
                                fontSize: '14px'
                            }),
                            multiValueRemove: (base) => ({
                                ...base,
                                color: 'var(--accent)',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                ':hover': { backgroundColor: 'var(--accent)', color: 'white' }
                            })
                        }}
                    />
                </div>

                <div className="input-group" style={{ marginTop: '20px' }}>
                    <label className="input-label" style={{ marginBottom: '8px' }}>关注维度</label>
                    <Select
                        isMulti
                        closeMenuOnSelect={false}
                        options={Object.entries(ALL_METRICS).map(([k, v]) => ({ value: k, label: v }))}
                        value={selectedMetrics.map(k => ({ value: k, label: ALL_METRICS[k] }))}
                        onChange={handleMetricsChange}
                        placeholder="搜索并选择要关注的数据维度..."
                        noOptionsMessage={() => "未找到该维度"}
                        formatOptionLabel={(option) => {
                            if (option.value === 'profit') {
                                return (
                                    <span style={{ fontWeight: 'bold', color: 'var(--danger)', fontSize: '15px' }}>
                                        🔥 {option.label}
                                    </span>
                                );
                            }
                            return option.label;
                        }}
                        styles={{
                            control: (base) => ({
                                ...base,
                                background: 'rgba(255, 255, 255, 0.8)',
                                borderColor: 'rgba(224, 122, 95, 0.2)',
                                borderRadius: '8px',
                                boxShadow: 'none',
                                '&:hover': { borderColor: 'var(--accent)' }
                            }),
                            valueContainer: (base) => ({
                                ...base,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'stretch',
                                padding: '8px',
                                gap: '4px'
                            }),
                            multiValue: (base) => ({
                                ...base,
                                display: 'flex',
                                justifyContent: 'space-between',
                                background: 'var(--accent)',
                                borderRadius: '6px',
                                padding: '4px 8px',
                                margin: 0
                            }),
                            multiValueLabel: (base) => ({
                                ...base,
                                color: 'white',
                                fontWeight: 500,
                                fontSize: '14px'
                            }),
                            multiValueRemove: (base) => ({
                                ...base,
                                color: 'white',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                ':hover': { backgroundColor: 'rgba(0,0,0,0.1)', color: 'white' }
                            })
                        }}
                    />
                </div>

                <div style={{ display: 'flex', gap: '16px', marginTop: '24px' }}>
                    <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={handleSearch} disabled={loading}>
                        {loading ? '查询中...' : '生成分析视图'}
                    </button>
                    <button className="btn" style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--text-muted)', flex: '0 0 auto' }} onClick={handleReset}>
                        清空重置
                    </button>
                </div>
            </div>

            {aggregatedData.length > 0 && (
                <>
                    {selectedMetrics.length === 1 && (
                        <div className="glass-panel mb-32">
                            <h3 style={{ marginBottom: '20px' }}>可视化分析引擎</h3>
                            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '20px' }}>
                                *当只选择一个维度时激活。趋势图展示该维度的时间变化(最多5个商品)；柱状图和饼图分析该维度的商品表现(TOP10)。
                            </p>

                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '24px', marginBottom: '24px' }}>
                                <div className="chart-container" style={{ height: '350px', background: 'rgba(255,255,255,0.4)', borderRadius: '12px', padding: '16px', border: '1px solid var(--glass-border)' }}>
                                    <ReactECharts option={getLineChartOption()} style={{ height: '100%' }} opts={{ renderer: 'svg' }} />
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px' }}>
                                <div className="chart-container" style={{ height: '350px', background: 'rgba(255,255,255,0.4)', borderRadius: '12px', padding: '16px', border: '1px solid var(--glass-border)' }}>
                                    <ReactECharts option={getPieChartOption()} style={{ height: '100%' }} opts={{ renderer: 'svg' }} />
                                </div>
                                <div className="chart-container" style={{ height: '350px', background: 'rgba(255,255,255,0.4)', borderRadius: '12px', padding: '16px', border: '1px solid var(--glass-border)' }}>
                                    <ReactECharts option={getBarChartOption()} style={{ height: '100%' }} opts={{ renderer: 'svg' }} />
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="glass-panel mb-32" style={{ paddingBottom: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h3 style={{ margin: 0 }}>多维度聚合数据表 (均值、极值、中位数)</h3>
                            <button className="btn" style={{ padding: '6px 14px', fontSize: '13px', background: 'var(--success)', whiteSpace: 'nowrap' }} onClick={handleExportExcel}>
                                下载 Excel 数据表
                            </button>
                        </div>

                        <div
                            className="top-scrollbar-wrapper"
                            ref={topScrollWrapperRef}
                            onScroll={handleTopScroll}
                        >
                            <div style={{ width: tableScrollWidth, height: '1px' }}></div>
                        </div>

                        <div
                            className="data-table-wrapper"
                            ref={tableWrapperRef}
                            onScroll={handleBottomScroll}
                        >
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>商品名称</th>
                                        <th>天数</th>
                                        {selectedMetrics.map(mKey => (
                                            <th key={mKey} colSpan="4" style={{ textAlign: 'center' }}>
                                                {ALL_METRICS[mKey]}
                                            </th>
                                        ))}
                                    </tr>
                                    <tr>
                                        <th></th>
                                        <th></th>
                                        {selectedMetrics.map(mKey => (
                                            <React.Fragment key={mKey + '_sub'}>
                                                {renderSortHeader('平均', mKey + '_avg', true)}
                                                {renderSortHeader('中位数', mKey + '_median')}
                                                {renderSortHeader('最大', mKey + '_max')}
                                                {renderSortHeader('最小', mKey + '_min')}
                                            </React.Fragment>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedData.map(row => (
                                        <tr key={row.product_id}>
                                            <td title={row.product_name} style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {row.product_name}
                                            </td>
                                            <td>{row.days_count}</td>
                                            {selectedMetrics.map(mKey => (
                                                <React.Fragment key={mKey + '_val'}>
                                                    <td style={{ color: 'var(--accent)' }}>
                                                        {row[mKey + '_avg'].toFixed(2)}
                                                    </td>
                                                    <td style={{ color: 'var(--text-main)', fontWeight: '600' }}>
                                                        {row[mKey + '_median'].toFixed(2)}
                                                    </td>
                                                    <td style={{ color: 'var(--success)' }}>
                                                        {row[mKey + '_max'].toFixed(2)}
                                                    </td>
                                                    <td style={{ color: 'var(--danger)' }}>
                                                        {row[mKey + '_min'].toFixed(2)}
                                                    </td>
                                                </React.Fragment>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default Compare;
