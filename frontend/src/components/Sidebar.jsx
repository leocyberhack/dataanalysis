import { NavLink } from 'react-router-dom';
import {
    BarChart2,
    CalendarCheck,
    ClipboardCheck,
    Coins,
    FileUp,
    LayoutDashboard,
    MousePointerClick,
    RefreshCcw,
    ShoppingCart,
    TrendingUp,
} from 'lucide-react';

const Sidebar = () => {
    return (
        <aside className="sidebar">
            <div className="sidebar-title">
                <LayoutDashboard size={24} color="var(--accent)" />
                数据罗盘
            </div>
            <nav className="nav-links">
                <NavLink to="/dashboard" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <LayoutDashboard size={20} />
                    <span>核心指标</span>
                </NavLink>
                <NavLink to="/compare" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <BarChart2 size={20} />
                    <span>多维分析</span>
                </NavLink>
                <NavLink to="/poi/traffic" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <MousePointerClick size={20} />
                    <span>流量入口</span>
                </NavLink>
                <NavLink to="/poi/conversion" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <TrendingUp size={20} />
                    <span>转化数据</span>
                </NavLink>
                <NavLink to="/poi/sales" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <ShoppingCart size={20} />
                    <span>销售数据</span>
                </NavLink>
                <NavLink to="/poi/refund" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <RefreshCcw size={20} />
                    <span>退款数据</span>
                </NavLink>
                <NavLink to="/poi/profit" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <Coins size={20} />
                    <span>利润数据</span>
                </NavLink>
                <NavLink to="/plans" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <CalendarCheck size={20} />
                    <span>计划设定</span>
                </NavLink>
                <NavLink to="/upload" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <FileUp size={20} />
                    <span>数据上传</span>
                </NavLink>
                <NavLink to="/review" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <ClipboardCheck size={20} />
                    <span>订单审核</span>
                </NavLink>
            </nav>
        </aside>
    );
};

export default Sidebar;
