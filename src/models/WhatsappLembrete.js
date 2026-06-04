import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { getTenantSchema } from '../config/tenantContext.js';

const WhatsappLembrete = sequelize.define('WhatsappLembrete', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  agendamento_id: {
    type: DataTypes.STRING(36),
    allowNull: false
  },
  tipo_lembrete: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  data_programada: {
    type: DataTypes.DATE,
    allowNull: false
  },
  data_envio: {
    type: DataTypes.DATE,
    allowNull: true
  },
  status: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  mensagem: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  erro: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  tentativas: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
}, {
  tableName: 'whatsapp_lembretes',
  createdAt: 'criado_em',
  updatedAt: 'atualizado_em'
});

export const getWhatsappLembreteModel = () => {
  const tenant = getTenantSchema();
  return WhatsappLembrete.schema(tenant);
};

export default WhatsappLembrete;
