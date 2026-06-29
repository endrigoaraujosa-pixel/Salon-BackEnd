import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';
import { getTenantSchema } from '../config/tenantContext.js';

const ColaboradorIndisponibilidade = sequelize.define('ColaboradorIndisponibilidade', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  colaborador_id: {
    type: DataTypes.STRING(36),
    allowNull: false
  },
  data_hora_inicio: {
    type: DataTypes.DATE,
    allowNull: false
  },
  data_hora_fim: {
    type: DataTypes.DATE,
    allowNull: false
  },
  motivo: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  criado_em: {
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
  tableName: 'colaborador_indisponibilidades',
  timestamps: false
});

export const getColaboradorIndisponibilidadeModel = () => {
  const tenant = getTenantSchema();
  return ColaboradorIndisponibilidade.schema(tenant);
};

export default ColaboradorIndisponibilidade;
