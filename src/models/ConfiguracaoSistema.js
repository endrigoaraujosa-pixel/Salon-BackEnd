import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { getTenantSchema } from '../config/tenantContext.js';

const ConfiguracaoSistema = sequelize.define('ConfiguracaoSistema', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  bloquear_valor_agendamento_menor: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  permitir_estoque_negativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  }
}, {
  tableName: 'configuracao_sistema',
  createdAt: 'criado_em',
  updatedAt: 'atualizado_em'
});

export const getConfiguracaoSistemaModel = () => {
  const tenant = getTenantSchema();
  return ConfiguracaoSistema.schema(tenant);
};

export default ConfiguracaoSistema;
