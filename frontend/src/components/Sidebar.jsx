import { NavLink } from 'react-router-dom';
import { LayoutDashboard, FileUp, BarChart2, ClipboardCheck } from 'lucide-react';

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
