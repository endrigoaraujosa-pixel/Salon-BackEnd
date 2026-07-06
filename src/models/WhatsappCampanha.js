import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { getTenantSchema } from '../config/tenantContext.js';

const WhatsappCampanha = sequelize.define('WhatsappCampanha', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  titulo: {
    type: DataTypes.STRING(255),
    allowNull: false,
    defaultValue: 'Mensagem em Massa'
  },
  mensagem: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  status: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'agendada'
    // Valores: 'agendada' | 'enviando' | 'enviada' | 'cancelada' | 'parcial'
  },
  agendado_para: {
    type: DataTypes.DATE,
    allowNull: true
  },
  enviado_em: {
    type: DataTypes.DATE,
    allowNull: true
  },
  total_clientes: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  enviados: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  falhas: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  criado_por: {
    type: DataTypes.STRING(255),
    allowNull: true
  }
}, {
  tableName: 'whatsapp_campanhas',
  createdAt: 'criado_em',
  updatedAt: 'atualizado_em'
});

export const getWhatsappCampanhaModel = () => {
  const tenant = getTenantSchema();
  return WhatsappCampanha.schema(tenant);
};

export default WhatsappCampanha;
