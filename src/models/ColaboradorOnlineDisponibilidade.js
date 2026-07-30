import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';
import { getTenantSchema } from '../config/tenantContext.js';

const ColaboradorOnlineDisponibilidade = sequelize.define('ColaboradorOnlineDisponibilidade', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  colaborador_id: {
    type: DataTypes.STRING(36),
    allowNull: false
  },
  dia_semana: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  hora_inicio: {
    type: DataTypes.STRING(5),
    allowNull: false
  },
  hora_fim: {
    type: DataTypes.STRING(5),
    allowNull: false
  },
  ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'colaborador_online_disponibilidade',
  createdAt: 'criado_em',
  updatedAt: 'atualizado_em'
});

export const getColaboradorOnlineDisponibilidadeModel = () => {
  const tenant = getTenantSchema();
  return ColaboradorOnlineDisponibilidade.schema(tenant);
};

export default ColaboradorOnlineDisponibilidade;
