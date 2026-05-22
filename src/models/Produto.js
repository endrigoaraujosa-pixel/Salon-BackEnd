import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';

const Produto = sequelize.define('Produto', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  nome: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  categoria: {
    type: DataTypes.STRING(255),
    defaultValue: ''
  },
  categoria_id: {
    type: DataTypes.STRING(36),
    allowNull: true
  },
  unidade_medida: {
    type: DataTypes.STRING(50),
    defaultValue: 'un'
  },
  quantidade_estoque: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  },
  estoque_minimo: {
    type: DataTypes.FLOAT,
    defaultValue: 5
  },
  custo_unitario: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  },
  preco_venda: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  },
  fornecedor: {
    type: DataTypes.STRING(255),
    defaultValue: ''
  },
  ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  comissao: {
    type: DataTypes.DECIMAL(10, 4),
    defaultValue: 0
  },
  criado_em: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  deletado: {
    type: DataTypes.STRING(1),
    defaultValue: 'N',
    allowNull: false
  },
  deletado_por: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  deletado_em: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'produtos'
});

export default Produto;
