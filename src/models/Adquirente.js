import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';
import { getTenantSchema } from '../config/tenantContext.js';

const Adquirente = sequelize.define('Adquirente', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  descricao: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false
  },
  observacao: {
    type: DataTypes.TEXT,
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
  },
  criado_por_id: {
    type: DataTypes.STRING(36),
    allowNull: true
  },
  criado_por_nome: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  alterado_por_id: {
    type: DataTypes.STRING(36),
    allowNull: true
  },
  alterado_por_nome: {
    type: DataTypes.STRING(255),
    allowNull: true
  }
}, {
  tableName: 'adquirentes',
  timestamps: true
});

export const getAdquirenteModel = () => {
  const tenant = getTenantSchema();
  return Adquirente.schema(tenant);
};

export default Adquirente;
