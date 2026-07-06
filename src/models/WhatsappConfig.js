import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { getTenantSchema } from '../config/tenantContext.js';

const WhatsappConfig = sequelize.define('WhatsappConfig', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  ativo: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  lembrete_24h: {
    type: DataTypes.INTEGER,
    defaultValue: 1
  },
  lembrete_2h: {
    type: DataTypes.INTEGER,
    defaultValue: 1
  },
  lembrete_1h: {
    type: DataTypes.INTEGER,
    defaultValue: 1
  },
  modelo_mensagem: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  api_url: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  instancia: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  token: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  agradecimento_ativo: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  agradecimento_tempo_minutos: {
    type: DataTypes.INTEGER,
    defaultValue: 30
  },
  agradecimento_modelo_mensagem: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  massa_intervalo_min: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 3
  },
  massa_intervalo_max: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 8
  }
}, {
  tableName: 'whatsapp_config',
  createdAt: 'criado_em',
  updatedAt: 'atualizado_em'
});

export const getWhatsappConfigModel = () => {
  const tenant = getTenantSchema();
  return WhatsappConfig.schema(tenant);
};


export default WhatsappConfig;
