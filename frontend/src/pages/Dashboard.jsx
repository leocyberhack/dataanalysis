import { useState, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';
import { ArrowUpRight, ArrowDownRight, Minus, AlertCircle } from 'lucide-react';
import { getDates, getSummary, getDetailedData } from '../api';

const Dashboard = () => {
    const [dates, setDates] = useState([]);
    const [selectedDate, setSelectedDate] = useState('');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        fetchDates();
    }, []);

    useEffect(() => {
        if (selectedDate) fetchSummary(selectedDate);
    }, [selectedDate]);

    const fetchDates = async () => {
        try {
            const dbDates = await getDates();
            setDates(dbDates);
            if (dbDates.length > 0) {
                setSelectedDate(dbDates[0]);
            }
        } catch (e) {
            console.error(e);
        }
    };

    const fetchSummary = async (date) => {
        setLoading(true);
        try {
            const summary = await getSummary(date);
            setData(summary);
        } catch (e) {
            console.error(e);
            setData(null);
        } finally {
            setLoading(false);
        }
    };

    if (!dates.length) {
        return (
            <div className="flex-col" style={{ alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <AlertCircle size={48} color="var(--text-muted)" />
                <p style={{ marginTop: '16px', color: 'var(--text-muted)' }}>暂无数据，请先前往数据上传页面导入数据。</p>
            </div>
        );
    }

    const renderMetric = (title, key, valueFormatter) => {
        if (!data || !data.today) return null;
        const value = data.today[key];
        const change = data.changes ? data.changes[key] : null;
        const hasYest = data.has_yesterday;

        return (
            <div className="glass-panel metric-card" key={key}>
                <div className="metric-title">{title}</div>
                <div className="metric-value">{valueFormatter(value)}</div>
                <div className="metric-change">
                    {!hasYest ? (
                        <span className="change-neutral">昨日数据未上传</span>
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

    const fmtCurrency = (v) => `¥${(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const fmtNumber = (v) => `${(v || 0).toLocaleString()}`;
    const fmtPercent = (v) => `${(v || 0).toFixed(2)}%`;

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">核心业务指标</h1>
                <select
                    className="select"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    style={{ width: '150px' }}
                >
                    {dates.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
            </div>

            {loading ? (
                <div>加载中...</div>
            ) : data?.today ? (
                <>
                    <div className="metrics-grid">
                        {renderMetric('当日总利润', 'profit', fmtCurrency)}
                        {renderMetric('利润率', 'profit_margin', fmtPercent)}
                        {renderMetric('当日总支付金额', 'pay_amount', fmtCurrency)}
                        {renderMetric('支付订单数', 'pay_orders', fmtNumber)}
                    </div>
                    <div className="metrics-grid" style={{ marginBottom: '24px' }}>
                        {renderMetric('总核销金额', 'redeem_amount', fmtCurrency)}
                        {renderMetric('核销率 (金额)', 'redeem_rate_amount', fmtPercent)}
                        {renderMetric('核销件数', 'redeem_items', fmtNumber)}
                        {renderMetric('核销率 (件数)', 'redeem_rate_item', fmtPercent)}
                    </div>
                    <div className="metrics-grid" style={{ marginBottom: '40px' }}>
                        {renderMetric('店播退款金额', 'live_refund_amount', fmtCurrency)}
                        {renderMetric('店播退款率', 'live_refund_rate', fmtPercent)}
                    </div>
                </>
            ) : (
                <div>获取数据出错或当日无数据结构。</div>
            )}
        </div>
    );
};

export default Dashboard;
