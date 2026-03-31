import { useState, useEffect, useMemo } from 'react';
import { CheckCircle, Edit3, Trash2, AlertTriangle, Package, Filter } from 'lucide-react';
import { getPendingOrders, approveOrder, updateOrderProfit, deletePendingOrder } from '../api';

const OrderReview = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState(null);
    const [editProfit, setEditProfit] = useState('');
    const [actionLoading, setActionLoading] = useState(null);

    // Date filter state
    const [filterYear, setFilterYear] = useState('');
    const [filterMonth, setFilterMonth] = useState('');
    const [filterDay, setFilterDay] = useState('');

    // Derived filter options from orders data
    const availableYears = useMemo(() =>
        [...new Set(orders.map(o => o.date.substring(0, 4)))].sort().reverse()
        , [orders]);

    const availableMonths = useMemo(() =>
        [...new Set(
            orders
                .filter(o => !filterYear || o.date.startsWith(filterYear))
                .map(o => o.date.substring(5, 7))
        )].sort()
        , [orders, filterYear]);

    const availableDays = useMemo(() =>
        [...new Set(
            orders
                .filter(o => {
                    if (filterYear && !o.date.startsWith(filterYear)) return false;
                    if (filterMonth && o.date.substring(5, 7) !== filterMonth) return false;
                    return true;
                })
                .map(o => o.date.substring(8, 10))
        )].sort()
        , [orders, filterYear, filterMonth]);

    const filteredOrders = useMemo(() =>
        orders.filter(o => {
            if (filterYear && !o.date.startsWith(filterYear)) return false;
            if (filterMonth && o.date.substring(5, 7) !== filterMonth) return false;
            if (filterDay && o.date.substring(8, 10) !== filterDay) return false;
            return true;
        })
        , [orders, filterYear, filterMonth, filterDay]);

    const fetchOrders = async () => {
        setLoading(true);
        try {
            const data = await getPendingOrders();
            setOrders(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchOrders();
    }, []);

    const handleApprove = async (order) => {
        if (!window.confirm(`确认以利润 ¥${order.profit.toFixed(2)} 审核通过此订单？\n商品：${order.product_name}`)) return;
        setActionLoading(order.id);
        try {
            await approveOrder(order.id);
            setOrders(prev => prev.filter(o => o.id !== order.id));
        } catch (e) {
            alert('审核失败：' + (e.response?.data?.detail || e.message));
        } finally {
            setActionLoading(null);
        }
    };

    const handleStartEdit = (order) => {
        setEditingId(order.id);
        setEditProfit(String(order.profit));
    };

    const handleSaveProfit = async (order) => {
        const newProfit = parseFloat(editProfit);
        if (isNaN(newProfit)) {
            alert('请输入有效的数字');
            return;
        }
        setActionLoading(order.id);
        try {
            await updateOrderProfit(order.id, newProfit);
            setOrders(prev => prev.map(o => o.id === order.id ? { ...o, profit: newProfit } : o));
            setEditingId(null);
        } catch (e) {
            alert('更新失败：' + (e.response?.data?.detail || e.message));
        } finally {
            setActionLoading(null);
        }
    };

    const handleDelete = async (order) => {
        if (!window.confirm(`确认删除此异常订单？\n商品：${order.product_name}\n此操作不可恢复。`)) return;
        setActionLoading(order.id);
        try {
            await deletePendingOrder(order.id);
            setOrders(prev => prev.filter(o => o.id !== order.id));
        } catch (e) {
            alert('删除失败：' + (e.response?.data?.detail || e.message));
        } finally {
            setActionLoading(null);
        }
    };

    const handleEditAndApprove = async (order) => {
        const newProfit = parseFloat(editProfit);
        if (isNaN(newProfit)) {
            alert('请输入有效的数字');
            return;
        }
        if (!window.confirm(`确认以修改后的利润 ¥${newProfit.toFixed(2)} 审核通过此订单？`)) return;
        setActionLoading(order.id);
        try {
            await updateOrderProfit(order.id, newProfit);
            await approveOrder(order.id);
            setOrders(prev => prev.filter(o => o.id !== order.id));
            setEditingId(null);
        } catch (e) {
            alert('操作失败：' + (e.response?.data?.detail || e.message));
        } finally {
            setActionLoading(null);
        }
    };

    return (
        <div>
            {/* Custom scrollbar styles */}
            <style>{`
                .review-scroll-area::-webkit-scrollbar {
                    width: 10px;
                }
                .review-scroll-area::-webkit-scrollbar-track {
                    background: rgba(0,0,0,0.06);
                    border-radius: 8px;
                }
                .review-scroll-area::-webkit-scrollbar-thumb {
                    background: rgba(224, 122, 95, 0.45);
                    border-radius: 8px;
                    border: 2px solid transparent;
                    background-clip: padding-box;
                }
                .review-scroll-area::-webkit-scrollbar-thumb:hover {
                    background: rgba(224, 122, 95, 0.7);
                    background-clip: padding-box;
                }
                .review-scroll-area {
                    scrollbar-width: auto;
                    scrollbar-color: rgba(224, 122, 95, 0.45) rgba(0,0,0,0.06);
                }
            `}</style>

            <div className="page-header">
                <h1 className="page-title">订单审核</h1>
            </div>

            <div className="glass-panel" style={{ marginBottom: '24px', padding: '16px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)', fontSize: '14px' }}>
                    <AlertTriangle size={18} color="#F59E0B" />
                    <span>以下订单利润为0或负值，已暂停分析录入。请逐条审核：确认无误可直接通过，利润有误可修改后录入，或直接丢弃删除。</span>
                </div>
            </div>

            {loading ? (
                <div className="glass-panel" style={{ textAlign: 'center', padding: '60px' }}>
                    <p style={{ color: 'var(--text-muted)' }}>加载中...</p>
                </div>
            ) : orders.length === 0 ? (
                <div className="glass-panel" style={{ textAlign: 'center', padding: '60px' }}>
                    <Package size={48} color="var(--text-muted)" style={{ marginBottom: '16px', opacity: 0.5 }} />
                    <p style={{ color: 'var(--text-muted)', fontSize: '16px' }}>暂无待审核订单 🎉</p>
                    <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '8px' }}>所有新上传的利润异常订单会自动出现在这里。</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* Filter bar */}
                    <div className="glass-panel" style={{ padding: '14px 20px' }}>
                        <div className="mobile-tag-row" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <Filter size={16} color="var(--text-muted)" />
                            <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 500 }}>筛选日期：</span>
                            <select
                                value={filterYear}
                                onChange={e => { setFilterYear(e.target.value); setFilterMonth(''); setFilterDay(''); }}
                                style={{
                                    padding: '5px 10px', borderRadius: '6px', fontSize: '13px',
                                    border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.8)',
                                    cursor: 'pointer', outline: 'none'
                                }}
                            >
                                <option value="">全部年份</option>
                                {availableYears.map(y => <option key={y} value={y}>{y}年</option>)}
                            </select>
                            <select
                                value={filterMonth}
                                onChange={e => { setFilterMonth(e.target.value); setFilterDay(''); }}
                                style={{
                                    padding: '5px 10px', borderRadius: '6px', fontSize: '13px',
                                    border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.8)',
                                    cursor: 'pointer', outline: 'none'
                                }}
                            >
                                <option value="">全部月份</option>
                                {availableMonths.map(m => <option key={m} value={m}>{parseInt(m)}月</option>)}
                            </select>
                            <select
                                value={filterDay}
                                onChange={e => setFilterDay(e.target.value)}
                                style={{
                                    padding: '5px 10px', borderRadius: '6px', fontSize: '13px',
                                    border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.8)',
                                    cursor: 'pointer', outline: 'none'
                                }}
                            >
                                <option value="">全部日期</option>
                                {availableDays.map(d => <option key={d} value={d}>{parseInt(d)}日</option>)}
                            </select>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                                共 <b>{filteredOrders.length}</b> / {orders.length} 条
                            </span>
                        </div>
                    </div>

                    <div className="glass-panel mobile-summary-row" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, fontSize: '15px' }}>
                            待审核订单：<span style={{ color: 'var(--danger)', fontSize: '20px' }}>{filteredOrders.length}</span> 条
                        </span>
                        <button
                            className="btn"
                            style={{ padding: '6px 14px', fontSize: '12px', opacity: 0.8 }}
                            onClick={fetchOrders}
                        >
                            刷新列表
                        </button>
                    </div>

                    <div className="review-scroll-area" style={{ maxHeight: 'calc(100vh - 340px)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', paddingRight: '4px' }}>
                        {filteredOrders.map(order => {
                            const isEditing = editingId === order.id;
                            const isProcessing = actionLoading === order.id;

                            return (
                                <div
                                    key={order.id}
                                    className="glass-panel mobile-review-card"
                                    style={{
                                        padding: '20px 24px',
                                        borderLeft: `4px solid ${order.profit < 0 ? 'var(--danger)' : '#F59E0B'}`,
                                        opacity: isProcessing ? 0.5 : 1,
                                        transition: 'all 0.3s ease',
                                        position: 'relative'
                                    }}
                                >
                                    {/* Top row: date + product */}
                                    <div className="mobile-review-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                        <div>
                                            <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                                                {order.product_name}
                                            </div>
                                        </div>
                                        <div style={{
                                            fontSize: '22px',
                                            fontWeight: 700,
                                            color: order.profit < 0 ? 'var(--danger)' : '#F59E0B',
                                            fontFamily: "'Inter', sans-serif"
                                        }}>
                                            {isEditing ? null : `¥${order.profit.toFixed(2)}`}
                                        </div>
                                    </div>

                                    {/* Key info row */}
                                    <div className="mobile-review-meta" style={{
                                        display: 'flex',
                                        gap: '24px',
                                        padding: '10px 0',
                                        borderTop: '1px solid var(--glass-border)',
                                        borderBottom: '1px solid var(--glass-border)',
                                        marginBottom: '12px',
                                        fontSize: '13px'
                                    }}>
                                        <div><span style={{ color: 'var(--text-muted)' }}>绑定日期：</span>{order.date}</div>
                                        <div><span style={{ color: 'var(--text-muted)' }}>订单号：</span>{order.order_id || '-'}</div>
                                        <div><span style={{ color: 'var(--text-muted)' }}>销售：</span>{order.salesperson || '-'}</div>
                                    </div>

                                    {/* Action row */}
                                    <div className="mobile-review-actions" style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                                        {isEditing ? (
                                            <>
                                                <div className="mobile-edit-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 auto' }}>
                                                    <span style={{ fontSize: '13px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>修正利润：</span>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        value={editProfit}
                                                        onChange={(e) => setEditProfit(e.target.value)}
                                                        style={{
                                                            padding: '6px 12px',
                                                            border: '1px solid var(--accent)',
                                                            borderRadius: '6px',
                                                            fontSize: '15px',
                                                            fontWeight: 600,
                                                            width: '140px',
                                                            outline: 'none',
                                                            fontFamily: "'Inter', sans-serif"
                                                        }}
                                                        autoFocus
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') handleEditAndApprove(order);
                                                            if (e.key === 'Escape') setEditingId(null);
                                                        }}
                                                    />
                                                </div>
                                                <button
                                                    className="btn"
                                                    style={{
                                                        padding: '6px 14px', fontSize: '13px',
                                                        background: 'var(--success)', color: 'white', display: 'flex', alignItems: 'center', gap: '4px'
                                                    }}
                                                    onClick={() => handleEditAndApprove(order)}
                                                    disabled={isProcessing}
                                                >
                                                    <CheckCircle size={14} /> 修改并录入
                                                </button>
                                                <button
                                                    className="btn"
                                                    style={{
                                                        padding: '6px 14px', fontSize: '13px',
                                                        background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--glass-border)'
                                                    }}
                                                    onClick={() => setEditingId(null)}
                                                >
                                                    取消
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <button
                                                    className="btn"
                                                    style={{
                                                        padding: '6px 14px', fontSize: '13px',
                                                        background: 'var(--success)', color: 'white', display: 'flex', alignItems: 'center', gap: '4px'
                                                    }}
                                                    onClick={() => handleApprove(order)}
                                                    disabled={isProcessing}
                                                >
                                                    <CheckCircle size={14} /> 审核通过
                                                </button>
                                                <button
                                                    className="btn"
                                                    style={{
                                                        padding: '6px 14px', fontSize: '13px',
                                                        background: 'var(--accent)', color: 'white', display: 'flex', alignItems: 'center', gap: '4px'
                                                    }}
                                                    onClick={() => handleStartEdit(order)}
                                                    disabled={isProcessing}
                                                >
                                                    <Edit3 size={14} /> 修改利润
                                                </button>
                                                <button
                                                    className="btn"
                                                    style={{
                                                        padding: '6px 14px', fontSize: '13px',
                                                        background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)',
                                                        display: 'flex', alignItems: 'center', gap: '4px'
                                                    }}
                                                    onClick={() => handleDelete(order)}
                                                    disabled={isProcessing}
                                                >
                                                    <Trash2 size={14} /> 丢弃订单
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default OrderReview;
