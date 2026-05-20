import React, { useMemo } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';
import { BarChart3, TrendingUp, PieChart as PieIcon, Activity } from 'lucide-react';

export const Reports: React.FC = () => {
  const { jobs } = useAppContext();
  const { user } = useAuth();
  const isSuper = user?.role === 'super_admin';

  // Filter jobs based on role
  const relevantJobs = useMemo(() => {
    if (isSuper) return jobs;
    return jobs.filter(j => j.createdByUid === user?.uid);
  }, [jobs, isSuper, user?.uid]);

  // Aggregate Data: Jobs by Status
  const statusData = useMemo(() => {
    const counts = { assigned: 0, pending_review: 0, completed: 0 };
    relevantJobs.forEach(j => { if (counts[j.status] !== undefined) counts[j.status]++; });
    return [
      { name: 'Assigned', value: counts.assigned, fill: '#3b82f6' },
      { name: 'Pending', value: counts.pending_review, fill: '#f59e0b' },
      { name: 'Completed', value: counts.completed, fill: '#10b981' },
    ];
  }, [relevantJobs]);

  // Aggregate Data: Jobs by Product
  const productData = useMemo(() => {
    const counts: Record<string, number> = {};
    relevantJobs.forEach(j => {
      counts[j.product] = (counts[j.product] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value], i) => ({
      name, value,
      fill: `hsl(${(i * 45) % 360}, 70%, 50%)`
    })).sort((a, b) => b.value - a.value).slice(0, 5); // top 5
  }, [relevantJobs]);

  // Aggregate Data: Jobs over time (Last 7 Days)
  const timeData = useMemo(() => {
    const days: Record<string, number> = {};
    // Initialize last 7 days
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days[d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })] = 0;
    }
    
    relevantJobs.forEach(j => {
      const d = new Date(j.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (days[d] !== undefined) days[d]++;
    });

    return Object.entries(days).map(([date, count]) => ({ date, count }));
  }, [relevantJobs]);

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

  if (relevantJobs.length === 0) {
    return (
      <div className="fade-in max-w-5xl mx-auto flex flex-col items-center justify-center py-20 text-muted">
        <Activity size={48} className="mb-4 opacity-50" />
        <h2 className="text-xl">Not enough data</h2>
        <p>Job analytics will appear here once jobs are generated.</p>
      </div>
    );
  }

  return (
    <div className="fade-in max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1 flex items-center gap-2">
          <BarChart3 className="text-blue" /> Analytics & Reports
        </h1>
        <p className="text-muted">
          {isSuper ? 'System-wide performance overview.' : 'Performance insights for your Regional Center.'}
        </p>
      </div>

      {/* KPI Row */}
      <div className="stats-grid mb-6">
        <div className="stat-card glass">
          <div className="stat-icon text-blue"><Activity /></div>
          <div className="stat-content">
            <h3>Total Jobs</h3>
            <p className="stat-value">{relevantJobs.length}</p>
          </div>
        </div>
        <div className="stat-card glass">
          <div className="stat-icon text-green"><TrendingUp /></div>
          <div className="stat-content">
            <h3>Completion Rate</h3>
            <p className="stat-value">
              {Math.round((statusData[2].value / (relevantJobs.length || 1)) * 100)}%
            </p>
          </div>
        </div>
        <div className="stat-card glass">
          <div className="stat-icon text-orange"><PieIcon /></div>
          <div className="stat-content">
            <h3>Top Product</h3>
            <p className="stat-value text-lg kpi-product-title">
              {productData[0]?.name || 'N/A'}
            </p>
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Trend Chart */}
        <div className="panel glass">
          <div className="panel-header">
            <h3>Job Volume (Last 7 Days)</h3>
          </div>
          <div className="panel-body chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeData}>
                <defs>
                  <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                <XAxis dataKey="date" stroke="rgba(255,255,255,0.4)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(255,255,255,0.4)" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                  itemStyle={{ color: '#e2e8f0' }}
                />
                <Area type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorCount)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Status Chart */}
        <div className="panel glass">
          <div className="panel-header">
            <h3>Current Job Status Pipeline</h3>
          </div>
          <div className="panel-body chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusData} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" stroke="rgba(255,255,255,0.4)" fontSize={12} allowDecimals={false} />
                <YAxis dataKey="name" type="category" stroke="rgba(255,255,255,0.6)" fontSize={12} width={80} />
                <RechartsTooltip 
                  cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                  contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Products Donut */}
        <div className="panel glass lg:col-span-2">
          <div className="panel-header">
            <h3>Top Products Serviced</h3>
          </div>
          <div className="panel-body chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={productData}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                  labelLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                >
                  {productData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>
    </div>
  );
};
