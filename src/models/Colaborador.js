import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';
import { getTenantSchema } from '../config/tenantContext.js';

const Colaborador = sequelize.define('Colaborador', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  nome: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  cargo: {
    type: DataTypes.STRING(255),
    defaultValue: ''
  },
  telefone: {
    type: DataTypes.STRING(50),
    defaultValue: ''
  },
  comissao_principal: {
    type: DataTypes.FLOAT,
    defaultValue: 40
  },
  comissao_sozinho: {
    type: DataTypes.FLOAT,
    defaultValue: 40
  },
  comissao_ajuda: {
    type: DataTypes.FLOAT,
    defaultValue: 30
  },
  comissao_auxiliar: {
    type: DataTypes.FLOAT,
    defaultValue: 20
  },
  usar_comissao_avancada: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  foto: {
    type: DataTypes.TEXT,
    allowNull: true
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
  tableName: 'colaboradores'
});

export const getColaboradorModel = () => {
  const tenant = getTenantSchema();
  return Colaborador.schema(tenant);
};

export default Colaborador;
