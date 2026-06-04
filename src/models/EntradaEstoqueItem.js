import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';
import { getTenantSchema } from '../config/tenantContext.js';

const EntradaEstoqueItem = sequelize.define('EntradaEstoqueItem', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  entrada_estoque_id: {
    type: DataTypes.STRING(36),
    allowNull: false
  },
  produto_id: {
    type: DataTypes.STRING(36),
    allowNull: false
  },
  produto_nome: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  quantidade: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0
  },
  valor_custo: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0
  },
  subtotal: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0
  },
  criado_em: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'entradas_estoque_itens',
  timestamps: true
});

export const getEntradaEstoqueItemModel = () => {
  const tenant = getTenantSchema();
  return EntradaEstoqueItem.schema(tenant);
};

export default EntradaEstoqueItem;
