import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { getTenantSchema } from '../config/tenantContext.js';
const AuthSession = sequelize.define('AuthSession', {
  id: { type: DataTypes.STRING(36), primaryKey: true },
  user_id: DataTypes.STRING(36),
  password_version: DataTypes.STRING(64),
  refresh_hash: DataTypes.STRING(64),
  previous_hash: DataTypes.STRING(64),
  rotated_at: DataTypes.DATE,
  expires_at: DataTypes.DATE,
  revoked_at: DataTypes.DATE,
  last_seen_at: DataTypes.DATE
}, { tableName: 'auth_sessions', timestamps: false });
export const getAuthSessionModel = () => AuthSession.schema(getTenantSchema());
