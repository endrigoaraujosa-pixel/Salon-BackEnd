import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';
import { getTenantSchema } from '../config/tenantContext.js';

const ClienteCreditoMovimentacao = sequelize.define('ClienteCreditoMovimentacao', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  cliente_id: {
    type: DataTypes.STRING(36),
    allowNull: false
  },
  tipo: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  tipo_operacao: {
    type: DataTypes.STRING(1), // 'C' or 'D'
    allowNull: false
  },
  valor: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  saldo_anterior: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  saldo_posterior: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  usuario_id: {
    type: DataTypes.STRING(36),
    allowNull: false
  },
  usuario_nome: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  origem: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  movimentacao_original_id: {
    type: DataTypes.STRING(36),
    allowNull: true
  },
  observacao: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  dispositivo: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  estornado: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  criado_em: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'cliente_credito_movimentacoes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
});

export const getClienteCreditoMovimentacaoModel = () => {
  const tenant = getTenantSchema();
  return ClienteCreditoMovimentacao.schema(tenant);
};

export default ClienteCreditoMovimentacao;
