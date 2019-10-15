import chalk from 'chalk'
import { chinook } from '../fixtures/chinook'
import { DMMFClass, makeDocument, transformDocument } from '../runtime'
import { getDMMF } from '../utils/getDMMF'
chalk.enabled = false

describe('relation where transformation', () => {
  let dmmf
  beforeAll(async () => {
    dmmf = new DMMFClass(await getDMMF({ datamodel: chinook }))
  })

  test('transform correctly', () => {
    const select = {
      where: {
        Albums: {
          some: {
            Tracks: {
              some: {
                AND: {
                  UnitPrice: 5,
                  Playlists: {
                    some: {
                      Tracks: {
                        some: {
                          Name: '',
                          Genre: {
                            id: 5,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }
    const document = makeDocument({
      dmmf,
      select,
      rootTypeName: 'query',
      rootField: 'findManyArtist',
    })
    expect(String(document)).toMatchInlineSnapshot(`
                        "query {
                          findManyArtist(where: {
                            Albums: {
                              some: {
                                Tracks: {
                                  some: {
                                    AND: [
                                      {
                                        UnitPrice: 5
                                        Playlists: {
                                          some: {
                                            Tracks: {
                                              \\"some\\": {
                                                \\"Name\\": \\"\\",
                                                \\"Genre\\": {
                                                  \\"id\\": 5
                                                }
                                              }
                                            }
                                          }
                                        }
                                      }
                                    ]
                                  }
                                }
                              }
                            }
                          }) {
                            id
                            Name
                          }
                        }"
                `)
    expect(String(transformDocument(document))).toMatchInlineSnapshot(`
                        "query {
                          findManyArtist(where: {
                            Albums_some: {
                              Tracks_some: {
                                AND: [
                                  {
                                    UnitPrice: 5
                                    Playlists_some_Tracks: {
                                      \\"some\\": {
                                        \\"Name\\": \\"\\",
                                        \\"Genre\\": {
                                          \\"id\\": 5
                                        }
                                      }
                                    }
                                  }
                                ]
                              }
                            }
                          }) {
                            id
                            Name
                          }
                        }"
                `)
  })

  test('throw correctly for incorrect deep scalar', () => {
    const select = {
      where: {
        Albums: {
          some: {
            Tracks: {
              some: {
                AND: {
                  UnitPrice: 5,
                  Playlists: {
                    some: {
                      Tracks: {
                        some: {
                          Name: '',
                          Genre: {
                            id: '5',
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }
    const document = makeDocument({
      dmmf,
      select,
      rootTypeName: 'query',
      rootField: 'findManyArtist',
    })
    expect(() => document.validate(select, false, 'users')).toThrowErrorMatchingInlineSnapshot(`
"
Invalid \`photon.users()\` invocation:

{
  where: {
    Albums: {
      some: {
        Tracks: {
          some: {
            AND: {
              UnitPrice: 5,
              Playlists: {
                some: {
                  Tracks: {
                  ~~~~~~
                    some: {
                      Name: '',
                      Genre: {
                        id: '5'
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

Unknown arg \`Tracks\` in where.Albums.some.Tracks.some.AND.0.Playlists.some.Tracks for type PlaylistTrackWhereInput. Did you mean \`Track\`? Available args:
type PlaylistTrackWhereInput {
  id?: Int | IntFilter
  AND?: PlaylistTrackWhereInput
  OR?: PlaylistTrackWhereInput
  NOT?: PlaylistTrackWhereInput
  Playlist?: PlaylistWhereInput
  Track?: TrackWhereInput
}

"
`)
  })
  test('throw correctly for deep at least one error', () => {
    const select = {
      where: {
        Albums: {
          some: {
            Tracks: {
              some: {
                AND: {
                  UnitPrice: 5,
                  Playlists: {
                    some: {
                      Tracks: {
                        some: {
                          Name: '',
                          Genre: {},
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }
    const document = makeDocument({
      dmmf,
      select,
      rootTypeName: 'query',
      rootField: 'findManyArtist',
    })
    expect(() => document.validate(select, false, 'artists')).toThrowErrorMatchingInlineSnapshot(`
"
Invalid \`photon.artists()\` invocation:

{
  where: {
    Albums: {
      some: {
        Tracks: {
          some: {
            AND: {
              UnitPrice: 5,
              Playlists: {
                some: {
                  Tracks: {
                  ~~~~~~
                    some: {
                      Name: '',
                      Genre: {}
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

Unknown arg \`Tracks\` in where.Albums.some.Tracks.some.AND.0.Playlists.some.Tracks for type PlaylistTrackWhereInput. Did you mean \`Track\`? Available args:
type PlaylistTrackWhereInput {
  id?: Int | IntFilter
  AND?: PlaylistTrackWhereInput
  OR?: PlaylistTrackWhereInput
  NOT?: PlaylistTrackWhereInput
  Playlist?: PlaylistWhereInput
  Track?: TrackWhereInput
}

"
`)
  })
})
