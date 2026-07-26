/**
 * 认证 & 用户管理 API
 */
import { post, get, put, del } from './request';
import type { UserInfo } from '../types';

export interface LoginParams {
  username: string;
  password: string;
}

export interface LoginResult {
  token: string;
  user: UserInfo;
}

/** 登录 */
export function loginApi(params: LoginParams) {
  return post<LoginResult>('/auth/login', params);
}

/** 获取当前用户信息 */
export function getMeApi() {
  return get<UserInfo>('/auth/me');
}

// ===== 用户管理（管理员） =====

export interface UserListResult {
  items: UserInfo[];
  total: number;
}

/** 获取用户列表（管理员） */
export function getUserList() {
  return get<UserListResult>('/users');
}

/** 获取单个用户 */
export function getUser(id: string) {
  return get<UserInfo>(`/users/${id}`);
}

export interface CreateUserParams {
  username: string;
  password: string;
  role: string;
  avatar?: string;
}

/** 创建用户（管理员） */
export function createUser(params: CreateUserParams) {
  return post<UserInfo>('/users', params);
}

export interface UpdateUserParams {
  username?: string;
  role?: string;
  avatar?: string;
}

/** 更新用户信息（管理员） */
export function updateUser(id: string, params: UpdateUserParams) {
  return put<UserInfo>(`/users/${id}`, params);
}

export interface ChangePasswordParams {
  oldPassword?: string;
  newPassword: string;
}

/** 修改密码 */
export function changePassword(id: string, params: ChangePasswordParams) {
  return put<null>(`/users/${id}/password`, params);
}

/** 删除用户（管理员） */
export function deleteUser(id: string) {
  return del<null>(`/users/${id}`);
}
