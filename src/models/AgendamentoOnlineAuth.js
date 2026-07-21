import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';
import { getTenantSchema } from '../config/tenantContext.js';

const AgendamentoOnlineAuth = sequelize.define('AgendamentoOnlineAuth', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  telefone: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  codigo_otp: {
    type: DataTypes.STRING(10),
    allowNull: false
  },
  expira_em: {
    type: DataTypes.DATE,
    allowNull: false
  },
  tentativas: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  validado: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  tableName: 'agendamento_online_auth',
  createdAt: 'criado_em',
  updatedAt: 'atualizado_em'
});

export const getAgendamentoOnlineAuthModel = () => {
  const tenant = getTenantSchema();
  return AgendamentoOnlineAuth.schema(tenant);
};

export default AgendamentoOnlineAuth;
