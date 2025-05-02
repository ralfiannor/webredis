import React from 'react';
import { Layout, Menu } from 'antd';
import { DatabaseOutlined, LinkOutlined } from '@ant-design/icons';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import ConnectionManager from './pages/ConnectionManager';
import DatabaseViewer from './pages/DatabaseViewer';

const { Header, Content, Sider } = Layout;

const AppLayout: React.FC = () => {
  const location = useLocation();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center' }}>
        <h1 style={{ color: 'white', margin: 0 }}>WebRedis</h1>
      </Header>
      <Layout>
        <Sider width={200} style={{ background: '#fff' }}>
          <Menu
            mode="inline"
            selectedKeys={[location.pathname]}
            style={{ height: '100%', borderRight: 0 }}
          >
            <Menu.Item key="/connections" icon={<LinkOutlined />}>
              <Link to="/connections">Connections</Link>
            </Menu.Item>
            <Menu.Item key="/databases" icon={<DatabaseOutlined />}>
              <Link to="/databases">Databases</Link>
            </Menu.Item>
          </Menu>
        </Sider>
        <Layout style={{ padding: '24px' }}>
          <Content style={{ background: '#fff', padding: 24, margin: 0, minHeight: 280 }}>
            <Routes>
              <Route path="/connections" element={<ConnectionManager />} />
              <Route path="/databases" element={<DatabaseViewer />} />
              <Route path="/" element={<ConnectionManager />} />
            </Routes>
          </Content>
        </Layout>
      </Layout>
    </Layout>
  );
};

const App: React.FC = () => {
  return (
    <Router>
      <AppLayout />
    </Router>
  );
};

export default App; 