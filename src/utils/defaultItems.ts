import { LaunchItem, Group } from '../types';

export const DEFAULT_SYSTEM_GROUP: Omit<Group, 'id'> = {
  name: '系统应用',
  color: '#6366f1',
  order: 0,
};

// 只包含不能直接通过 Win+R 运行的系统工具，避免覆盖系统自带别名
// 像 notepad、calc、cmd、powershell、regedit、msconfig、mstsc 等
// 本身就能通过 Win+R 直接运行，不需要注册别名
export const DEFAULT_SYSTEM_ITEMS: Omit<LaunchItem, 'id' | 'createdAt' | 'lastUsed'>[] = [
  {
    name: '服务',
    alias: 'services',
    targetPath: 'services.msc',
    description: 'Windows 服务管理',
    runAsAdmin: true,
    startupEnabled: false,
  },
  {
    name: '事件查看器',
    alias: 'eventvwr',
    targetPath: 'eventvwr.msc',
    description: 'Windows 事件查看器',
    runAsAdmin: false,
    startupEnabled: false,
  },
  {
    name: '设备管理器',
    alias: 'devmgmt',
    targetPath: 'devmgmt.msc',
    description: 'Windows 设备管理器',
    runAsAdmin: true,
    startupEnabled: false,
  },
  {
    name: '磁盘管理',
    alias: 'diskmgmt',
    targetPath: 'diskmgmt.msc',
    description: 'Windows 磁盘管理',
    runAsAdmin: true,
    startupEnabled: false,
  },
];
