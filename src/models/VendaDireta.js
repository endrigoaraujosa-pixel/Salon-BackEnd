import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';

const VendaDireta = sequelize.define('VendaDireta', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  numero_venda: {
    type: DataTypes.INTEGER,
    defaultValue: null
  },
  data_venda: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
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
    allowNull: false
  },
  colaborador_id: {
    type: DataTypes.STRING(36),
    allowNull: true
  },
  colaborador_nome: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  cliente_id: {
    type: DataTypes.STRING(36),
    allowNull: true
  },
  cliente_nome: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  valor_total: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  },
  valor_pago: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  },
  itens: {
    type: DataTypes.JSON,
    defaultValue: []
  },
  desconto_aplicado: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null
  },
  data_lancamento: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  criado_por_id: {
    type: DataTypes.STRING(36),
    allowNull: true
  },
  criado_por_nome: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  status: {
    type: DataTypes.STRING(50),
    defaultValue: 'pendente'
  },
  comissao_paga: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
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
  tableName: 'vendas_diretas',
  timestamps: false
});

export default VendaDireta;
