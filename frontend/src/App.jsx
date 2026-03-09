import { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Upload = lazy(() => import('./pages/Upload'));
const Compare = lazy(() => import('./pages/Compare'));
const OrderReview = lazy(() => import('./pages/OrderReview'));

function App() {
  return (
    <Router>
        <div className="layout">
          <Sidebar />
          <main className="main-content">
            <Suspense fallback={<div>Loading...</div>}>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/upload" element={<Upload />} />
                <Route path="/compare" element={<Compare />} />
                <Route path="/review" element={<OrderReview />} />
              </Routes>
            </Suspense>
          </main>
        </div>
    </Router>
  );
}

export default App;
