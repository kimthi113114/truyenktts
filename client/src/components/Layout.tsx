import React from 'react';
import { Layout as AntLayout } from 'antd';
import Header from './Header';
import { useLocation } from 'react-router-dom';

const { Content, Footer } = AntLayout;

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {

    const location = useLocation();

    const isFullPage = location.pathname.startsWith('/listen') || location.pathname.startsWith('/audio') || location.pathname.startsWith('/audio-v2');

    if (isFullPage) {
        return children;
    }

    return (
        <AntLayout >
            {location.pathname === "/" ? <Header /> : <></>}
            <Content >
                <div style={{ background: '#fff', borderRadius: 8, minHeight: 280, height: '100%', padding: 24 }}>
                    {children}
                </div>
            </Content>
            {location.pathname === "/" ? <Footer style={{ textAlign: 'center' }}>
                Truyện K-TTS ©{new Date().getFullYear()} Created by KimThi
            </Footer> : <></>}

        </AntLayout>
    );
};

export default Layout;
