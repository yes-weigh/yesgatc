import React from 'react';

type RCModulePageProps = {
  title: string;
  icon: React.ReactNode;
  description?: string;
};

export const RCModulePage: React.FC<RCModulePageProps> = ({
  title,
  icon,
  description = 'This module is coming soon.',
}) => (
  <div className="fade-in page-content">
    <div className="panel glass">
      <div className="panel-header">
        <h2>
          {icon}
          {title}
        </h2>
      </div>
      <div className="panel-body">
        <p className="text-muted m-0">{description}</p>
      </div>
    </div>
  </div>
);
