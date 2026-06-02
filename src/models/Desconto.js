import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';

const Desconto = sequelize.define('Desconto', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  codigo: {
    type: DataTypes.STRING(100),
    unique: true,
    allowNull: false
  },
  descricao: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  tipo: {
    type: DataTypes.STRING(50), // 'porcentagem' or 'valor_fixo'
    defaultValue: 'porcentagem',
    allowNull: false
  },
  valor: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0
  },
  ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  itens_vinculados: {
    type: DataTypes.TEXT, // JSON: { services: [id1, id2], products: [id1, id2] }
    allowNull: true
  },
  requer_autorizacao: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  incide_comissao: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  usuarios_autorizados: {
    type: DataTypes.TEXT, // JSON: [userId1, userId2]
    allowNull: true
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
  tableName: 'descontos',
  timestamps: true
});

export default Desconto;
