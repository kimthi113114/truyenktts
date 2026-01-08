import React from 'react';
import { Layout, Avatar, Dropdown, Space } from 'antd';
import type { MenuProps } from 'antd';
import { LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import './Header.css';

const { Header: AntHeader } = Layout;

const Header: React.FC = () => {
    const navigate = useNavigate();
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    const handleLogout = () => {
        localStorage.removeItem('user');
        navigate('/login');
    };

    const items: MenuProps['items'] = [
        {
            key: 'logout',
            label: 'Đăng xuất',
            icon: <LogoutOutlined />,
            onClick: handleLogout,
        },
    ];

    return (
        <AntHeader className="app-header">
            <div className="header-container">
                <div className="header-logo-section" onClick={() => navigate('/')}>
                    <img src="/favico.png" alt="Logo" className="header-logo-img" />
                    <h3 className="header-title-wrapper">
                        <span className="header-title-text">K-TTS</span>
                        <span className="version-pill">v2.8.3</span>
                    </h3>
                </div>
                {user.username && (
                    <Dropdown menu={{ items }} placement="bottomRight" arrow>
                        <Space className="user-menu-trigger">
                            <span className="user-greeting">Xin chào, <strong className="user-name">{user.username}</strong></span>
                            <Avatar icon={<UserOutlined />} style={{ backgroundColor: '#1677ff' }} />
                        </Space>
                    </Dropdown>
                )}
            </div>
        </AntHeader>
    );
};

export default Header;
