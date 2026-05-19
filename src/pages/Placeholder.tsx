import React from 'react';
import { useLocation } from 'react-router-dom';

export const Placeholder: React.FC = () => {
  const location = useLocation();
  const title = location.pathname.split('/').pop()?.toUpperCase() || 'Page';

  return (
    <div className="fade-in flex items-center justify-center h-full">
      <div className="panel glass text-center max-w-md w-full">
        <h2 className="mb-4">{title} Module</h2>
        <p className="text-muted mb-6">This module is currently under development.</p>
        <div className="bg-shapes absolute inset-0 -z-10 opacity-20 pointer-events-none">
           <div className="shape shape-1" style={{ width: '150px', height: '150px' }}></div>
        </div>
      </div>
    </div>
  );
};
