import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolTopicService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async listTopics(query: any) {
    let sql = `SELECT * FROM topics WHERE 1=1`;
    const params: any[] = [];
    if (query.subjectId) { params.push(query.subjectId); sql+=` AND subject_id=$${params.length}`; }
    const rows: any[] = await this.ds.query(sql+` ORDER BY name`, params);
    return { success: true, data: rows };
  }

  async createTopic(body: any) {
    const rows: any[] = await this.ds.query(`INSERT INTO topics (subject_id,name,description,order_index) VALUES ($1,$2,$3,$4) RETURNING *`, [body.subjectId,body.name,body.description||null,body.orderIndex||0]);
    return { success: true, data: rows[0] };
  }

  async updateTopic(id: string, body: any) {
    await this.ds.query(`UPDATE topics SET name=COALESCE($2,name),description=COALESCE($3,description),order_index=COALESCE($4,order_index),updated_at=NOW() WHERE id=$1`, [id,body.name,body.description,body.orderIndex]);
    return { success: true };
  }

  async deleteTopic(id: string) {
    await this.ds.query(`DELETE FROM topics WHERE id=$1`, [id]);
    return { success: true };
  }

  async listChapters(query: any) {
    let sql = `SELECT * FROM chapters WHERE 1=1`;
    const params: any[] = [];
    if (query.topicId) { params.push(query.topicId); sql+=` AND topic_id=$${params.length}`; }
    if (query.instituteId) { params.push(query.instituteId); sql+=` AND institute_id=$${params.length}`; }
    const rows: any[] = await this.ds.query(sql+` ORDER BY order_index`, params);
    return { success: true, data: rows };
  }

  async createChapter(body: any) {
    const rows: any[] = await this.ds.query(`INSERT INTO chapters (topic_id,institute_id,name,description,order_index) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [body.topicId,body.instituteId||null,body.name,body.description||null,body.orderIndex||0]);
    return { success: true, data: rows[0] };
  }

  async updateChapter(id: string, body: any) {
    await this.ds.query(`UPDATE chapters SET name=COALESCE($2,name),description=COALESCE($3,description),order_index=COALESCE($4,order_index),updated_at=NOW() WHERE id=$1`, [id,body.name,body.description,body.orderIndex]);
    return { success: true };
  }

  async deleteChapter(id: string) {
    await this.ds.query(`DELETE FROM chapters WHERE id=$1`, [id]);
    return { success: true };
  }
}
