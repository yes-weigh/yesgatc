import React from 'react';
import { GraduationCap } from 'lucide-react';
import { RCModulePage } from '../rc/RCModulePage';

export const VCTTraining: React.FC = () => (
  <RCModulePage
    title="Training"
    icon={<GraduationCap className="inline-icon" />}
    description="Training materials and certification progress will appear here."
  />
);
