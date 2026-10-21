// Single source of truth for the demo people (used by prisma/seed.js, prisma/dedupe-demo-users.js and routes/dev.routes.js).
// role: PLATFORM_ADMIN = Boss / root admin, MANAGER = team manager, EMPLOYEE = team member
export const STAFF = [
  { key: 'arjun', email: 'arjun.demo@tendrils.io', name: 'Arjun Mehta', role: 'PLATFORM_ADMIN', teams: ['management-operations'] },
  { key: 'rahul', email: 'rahul.demo@tendrils.io', name: 'Rahul Verma', role: 'MANAGER', teams: ['development'] },
  { key: 'nisha', email: 'nisha.demo@tendrils.io', name: 'Nisha Rao', role: 'MANAGER', teams: ['graphics-creative'] },
  { key: 'kavya', email: 'kavya.demo@tendrils.io', name: 'Kavya Nair', role: 'MANAGER', teams: ['seo-marketing'] },
  { key: 'vikram', email: 'vikram.demo@tendrils.io', name: 'Vikram Singh', role: 'MANAGER', teams: ['qa'] },
  { key: 'anil', email: 'anil.demo@tendrils.io', name: 'Anil Kumar', role: 'MANAGER', teams: ['it-infrastructure'] },
  { key: 'priya', email: 'priya.demo@tendrils.io', name: 'Priya Shah', role: 'MANAGER', teams: ['product', 'management-operations'] },
  { key: 'sneha', email: 'sneha.demo@tendrils.io', name: 'Sneha Kulkarni', role: 'EMPLOYEE', teams: ['development'] },
  { key: 'aditya', email: 'aditya.demo@tendrils.io', name: 'Aditya Joshi', role: 'EMPLOYEE', teams: ['development', 'qa'] },
  { key: 'karan', email: 'karan.demo@tendrils.io', name: 'Karan Patil', role: 'EMPLOYEE', teams: ['graphics-creative'] },
  { key: 'meera', email: 'meera.demo@tendrils.io', name: 'Meera Iyer', role: 'EMPLOYEE', teams: ['seo-marketing'] },
  { key: 'pooja', email: 'pooja.demo@tendrils.io', name: 'Pooja Desai', role: 'EMPLOYEE', teams: ['qa'] },
  { key: 'nikhil', email: 'nikhil.demo@tendrils.io', name: 'Nikhil Gupta', role: 'EMPLOYEE', teams: ['it-infrastructure'] },
  { key: 'ritu', email: 'ritu.demo@tendrils.io', name: 'Ritu Sen', role: 'EMPLOYEE', teams: ['product'] },
];

export const CLIENTS = [
  { name: 'Sofabed', slug: 'sofabed', users: [
    { key: 'rohan', email: 'boss.demo@sofabed.test', name: 'Rohan Malhotra', role: 'CLIENT_ADMIN' },
    { key: 'neha', email: 'sofabed.demo@sofabed.test', name: 'Neha Arora', role: 'CLIENT_MEMBER' }] },
  { name: 'JenniHome', slug: 'jennihome', users: [
    { key: 'sanjay', email: 'boss.demo@jennihome.test', name: 'Sanjay Bhatia', role: 'CLIENT_ADMIN' },
    { key: 'tanvi', email: 'jennihome.demo@jennihome.test', name: 'Tanvi Kapoor', role: 'CLIENT_MEMBER' }] },
  { name: 'Jennifer Furniture', slug: 'jennifer-furniture', users: [
    { key: 'divya', email: 'boss.demo@jennifer-furniture.test', name: 'Divya Menon', role: 'CLIENT_ADMIN' }] },
  { name: 'Comfort Furniture', slug: 'comfort-furniture', users: [
    { key: 'imran', email: 'boss.demo@comfort-furniture.test', name: 'Imran Qureshi', role: 'CLIENT_ADMIN' }] },
];


export const CANONICAL_EMAILS = new Set([...STAFF.map((p) => p.email), ...CLIENTS.flatMap((c) => c.users.map((p) => p.email))].map((e) => e.toLowerCase()));
export const CANONICAL_NAMES = new Set([...STAFF.map((p) => p.name), ...CLIENTS.flatMap((c) => c.users.map((p) => p.name))].map((n) => n.trim().toLowerCase()));
