import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';
import { getTenantSchema } from '../config/tenantContext.js';

const MotivoMovimentacao = sequelize.define('MotivoMovimentacao', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  nome: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  tipo: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false
  }
}, {
  tableName: 'motivos_movimentacao',
  timestamps: true
});

export const getMotivoMovimentacaoModel = () => {
  const tenant = getTenantSchema();
  return MotivoMovimentacao.schema(tenant);
};

export default MotivoMovimentacao;
