import { DataSource, DataSourceOptions } from 'typeorm';
import { schoolDbConfig } from './database.config';
export default new DataSource({ ...schoolDbConfig, name: 'default' } as DataSourceOptions);
