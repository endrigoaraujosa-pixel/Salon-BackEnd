import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';
import { getTenantSchema } from '../config/tenantContext.js';

const EntradaEstoque = sequelize.define('EntradaEstoque', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  fornecedor_id: {
    type: DataTypes.STRING(36),
    allowNull: true
  },
  fornecedor_nome: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  data_entrada: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  numero_nota: {
    type: DataTypes.STRING(100),
    defaultValue: ''
  },
  serie_nota: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: ''
  },
  observacoes: {
    type: DataTypes.TEXT,
    defaultValue: ''
  },
  valor_total: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0
  },
  criado_em: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'entradas_estoque',
  timestamps: true
});

export const getEntradaEstoqueModel = () => {
  const tenant = getTenantSchema();
  return EntradaEstoque.schema(tenant);
};

export default EntradaEstoque;
