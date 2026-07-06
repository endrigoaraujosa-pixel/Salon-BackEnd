import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { getTenantSchema } from '../config/tenantContext.js';

const WhatsappCampanhaEnvio = sequelize.define('WhatsappCampanhaEnvio', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  campanha_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  cliente_id: {
    type: DataTypes.STRING(36),
    allowNull: true
  },
  cliente_nome: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  telefone: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  mensagem_enviada: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  status: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'pendente'
    // Valores: 'pendente' | 'enviado' | 'falhou'
  },
  erro: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  enviado_em: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'whatsapp_campanhas_envios',
  createdAt: 'criado_em',
  updatedAt: 'atualizado_em'
});

export const getWhatsappCampanhaEnvioModel = () => {
  const tenant = getTenantSchema();
  return WhatsappCampanhaEnvio.schema(tenant);
};

export default WhatsappCampanhaEnvio;
