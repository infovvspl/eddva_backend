import { schoolDbConfig } from './database.config';
import { DataSource, DataSourceOptions } from 'typeorm';
export default new DataSource(schoolDbConfig as DataSourceOptions);
