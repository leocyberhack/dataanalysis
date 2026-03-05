import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Upload from './pages/Upload';
import Compare from './pages/Compare';
import OrderReview from './pages/OrderReview';

function App() {
  return (
    <Router>
      <div className="layout">
        <Sidebar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/review" element={<OrderReview />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
