import { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Upload = lazy(() => import('./pages/Upload'));
const Compare = lazy(() => import('./pages/Compare'));
const OrderReview = lazy(() => import('./pages/OrderReview'));
const POIInsight = lazy(() => import('./pages/POIInsight'));
const PlanSettings = lazy(() => import('./pages/PlanSettings'));
const DeepAnalysis = lazy(() => import('./pages/DeepAnalysis'));
const CloudDataExport = lazy(() => import('./pages/CloudDataExport'));
const ProductReviews = lazy(() => import('./pages/ProductReviews'));

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
                <Route path="/poi/:module" element={<POIInsight />} />
                <Route path="/plans" element={<PlanSettings />} />
                <Route path="/deep-analysis" element={<DeepAnalysis />} />
                <Route path="/product-reviews" element={<ProductReviews />} />
                <Route path="/cloud-data" element={<CloudDataExport />} />
              </Routes>
            </Suspense>
          </main>
        </div>
    </Router>
  );
}

export default App;
