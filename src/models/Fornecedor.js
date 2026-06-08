import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';
import { getTenantSchema } from '../config/tenantContext.js';

const Fornecedor = sequelize.define('Fornecedor', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  nome_razosocial: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  cpf_cnpj: {
    type: DataTypes.STRING(50),
    defaultValue: ''
  },
  telefone: {
    type: DataTypes.STRING(50),
    defaultValue: ''
  },
  email: {
    type: DataTypes.STRING(255),
    defaultValue: ''
  },
  endereco: {
    type: DataTypes.TEXT,
    defaultValue: ''
  },
  observacoes: {
    type: DataTypes.TEXT,
    defaultValue: ''
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
  tableName: 'fornecedores'
});

export const getFornecedorModel = () => {
  const tenant = getTenantSchema();
  return Fornecedor.schema(tenant);
};

export default Fornecedor;
