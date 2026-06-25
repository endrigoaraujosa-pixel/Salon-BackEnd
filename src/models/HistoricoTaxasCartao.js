import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';
import { getTenantSchema } from '../config/tenantContext.js';

const HistoricoTaxasCartao = sequelize.define('HistoricoTaxasCartao', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  taxa_cartao_id: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  operacao: {
    type: DataTypes.STRING(20),
    allowNull: false
  },
  schema: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  alterado_por_id: {
    type: DataTypes.STRING(36),
    allowNull: true
  },
  alterado_por_nome: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  valores_anteriores: {
    type: DataTypes.JSON,
    allowNull: true
  },
  valores_novos: {
    type: DataTypes.JSON,
    allowNull: true
  },
  ip_origem: {
    type: DataTypes.STRING(45),
    allowNull: true
  },
  motivo_alteracao: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'historico_taxas_cartao',
  timestamps: false
});

export const getHistoricoTaxasCartaoModel = () => {
  const tenant = getTenantSchema();
  return HistoricoTaxasCartao.schema(tenant);
};

export default HistoricoTaxasCartao;
