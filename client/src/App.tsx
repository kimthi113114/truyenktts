import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.tsx';
import './App.css';
import Login from './pages/Login.tsx';
import Home from './pages/Home.tsx';
import Read from './pages/Read.tsx';
import AudioPlayer from './pages/AudioPlayer.tsx';

const PrivateRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isAuthenticated = !!localStorage.getItem('user');
  return isAuthenticated ?
    <Layout>{children}</Layout> :
    <Navigate to="/login" />;
};
function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={<PrivateRoute><Home /></PrivateRoute>}
        />
        <Route
          path="/listen/:storyId?/:chapterId?"
          element={<PrivateRoute><Read /></PrivateRoute>}
        />
        <Route
          path="/audio/:storyId?/:chapterId?"
          element={<PrivateRoute><AudioPlayer /></PrivateRoute>}
        />
      </Routes>
    </Router>
  );
}

export default App;
